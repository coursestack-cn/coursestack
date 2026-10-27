import type { requireSession } from '../auth/service.ts';
import { HttpError } from '../http.ts';
import { conflict } from './validation.ts';

export type Session = Awaited<ReturnType<typeof requireSession>>;
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";

// Admission survives session revocation. Identity deletion is checked in the write transaction.
export async function mutateAccount(
    binding: D1Database, session: Session, targetId: string, adminOnly: boolean,
    statements: (gate: string) => D1PreparedStatement[],
) {
    if (adminOnly ? session.role !== 'admin' : session.id !== targetId) {
        throw new HttpError(403, 'FORBIDDEN', '没有修改此账号的权限');
    }
    const gate = `EXISTS (SELECT 1 FROM accounts actor, accounts target
        WHERE actor.id = ${literal(session.id)} AND target.id = ${literal(targetId)}
        AND actor.status <> 'deleted' AND target.status <> 'deleted')`;
    try {
        const result = await binding.batch([
            binding.prepare(`SELECT 1 AS allowed WHERE ${gate}`),
            ...statements(gate),
        ]);
        if (!result[0].results.length) throw new HttpError(409, 'ACCOUNT_DELETED', '账号身份已变更或删除，请重新登录或刷新账号列表');
        return result;
    } catch (error) { conflict(error); }
}