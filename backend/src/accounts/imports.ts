import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { ACCOUNT_IMPORT_BYTES, ACCOUNT_IMPORT_LIMIT, accountColumns, accountErrors, normalizeAccount, type AccountInput, type PreviewItem } from '../../../shared/accounts/import.ts';
import { input, respond, HttpError } from '../http.ts';
import { requireAdministrator, administration } from '../permissions.ts';
import { createDatabase } from '../db/index.ts';
import { type AppEnv } from '../discussions/types.ts';

export const accountImportRoutes = new Hono<AppEnv>();
accountImportRoutes.post('/admin/accounts/import/preview', async c => {
    const a = await requireAdministrator(c);
    const data = await input(c, z.object({ rows: z.array(z.object({ line: z.number().int().min(1).max(ACCOUNT_IMPORT_BYTES),
        values: z.object(Object.fromEntries(accountColumns.map(({ key }) => [key, z.string()]))).strict() }).strict()).min(1).max(ACCOUNT_IMPORT_LIMIT) }).strict(), ACCOUNT_IMPORT_BYTES);
    if (new Set(data.rows.map(row => row.line)).size !== data.rows.length) throw new HttpError(400, 'VALIDATION_ERROR', '行号不能重复');
    const rows = data.rows.map(row => ({ line: row.line, values: normalizeAccount(row.values as AccountInput) }));
    const existing = await createDatabase(c.env.DB).all<{ schoolNumber: string; role: string }>(sql`
        SELECT school_number AS schoolNumber,role FROM accounts WHERE status<>'deleted' AND ${administration(a)}
        AND school_number IN (SELECT value FROM json_each(${JSON.stringify(rows.map(row => row.values.schoolNumber))}))`);
    const accounts = new Map(existing.map(account => [account.schoolNumber, account.role]));
    const groups = new Map<string, typeof rows>();
    for (const row of rows) if (row.values.schoolNumber) groups.set(row.values.schoolNumber, [...(groups.get(row.values.schoolNumber) ?? []), row]);
    const conflicts = new Set([...groups].filter(([, group]) => new Set(group.map(row => JSON.stringify(row.values))).size > 1).map(([number]) => number));
    const items: PreviewItem[] = rows.map(row => {
        const group = groups.get(row.values.schoolNumber) ?? [row];
        if (conflicts.has(row.values.schoolNumber)) return { line: row.line, status: 'invalid', message: '同一学工号的多行内容不同，请统一后重新上传' };
        if (group[0] !== row) return { line: row.line, status: 'duplicate', message: `与第${group[0]!.line}行重复` };
        const errors = accountErrors(row.values);
        if (errors.length) return { line: row.line, status: 'invalid', message: errors.join('；') };
        const role = accounts.get(row.values.schoolNumber);
        if (role && role !== row.values.role) return { line: row.line, status: 'invalid', message: '学工号已被另一身份的账号使用' };
        if (role) return { line: row.line, status: 'existing', message: '账号已存在，资料和密码保持原值' };
        return { line: row.line, status: 'ready', message: '' };
    });
    return respond(c, { items });
});