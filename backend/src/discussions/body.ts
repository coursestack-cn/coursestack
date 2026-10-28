import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { validateDoc, type RichTextDoc } from '../../../shared/rich-text/index.ts';

export type ProseMirrorDocument = RichTextDoc;
export const bodySchema = z.custom<ProseMirrorDocument>(value => validateDoc(value).ok,
    '正文须符合共享富文本白名单，最多 30000 个语义字符、368 KiB，列表与引用最多嵌套 16 层');

export const parseBody = (value: string | null): ProseMirrorDocument | null => value === null ? null : JSON.parse(value);

// Compare the stored JSON inside the UPDATE so concurrent edits cannot stale the comparison.
// Object key order and whitespace are immaterial; array order remains part of the content.
export function jsonChanged(column: SQL, value: string | null): SQL {
    const entries = (expression: SQL) => sql`SELECT fullkey,
        CASE WHEN type IN ('integer','real') THEN 'number' ELSE type END AS kind,atom FROM json_tree(${expression})`;
    return sql`(EXISTS(${entries(column)} EXCEPT ${entries(sql`${value}`)})
        OR EXISTS(${entries(sql`${value}`)} EXCEPT ${entries(column)}))`;
}