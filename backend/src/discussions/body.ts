import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

export type ProseMirrorMark = { type: string; attrs?: Record<string, unknown> };
export type ProseMirrorNode = { type: string; attrs?: Record<string, unknown>; text?: string;
    content?: ProseMirrorNode[]; marks?: ProseMirrorMark[] };
export type ProseMirrorDocument = ProseMirrorNode & { type: 'doc' };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

// Validate the JSON envelope without choosing the editor's extension schema.
function isDocument(value: unknown): value is ProseMirrorDocument {
    if (!record(value) || value.type !== 'doc') return false;
    const pending = [{ node: value, depth: 0 }];
    while (pending.length) {
        const { node, depth } = pending.pop()!;
        if (depth > 64 || !record(node) || !name(node.type)) return false;
        if (Object.keys(node).some(key => !['type', 'attrs', 'text', 'content', 'marks'].includes(key))) return false;
        if (node.attrs !== undefined && !record(node.attrs)) return false;
        if (node.type === 'text') {
            if (typeof node.text !== 'string' || !node.text.length || node.content !== undefined) return false;
        } else if (node.text !== undefined) return false;
        if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.some(mark =>
            !record(mark) || !name(mark.type) || (mark.attrs !== undefined && !record(mark.attrs))
            || Object.keys(mark).some(key => !['type', 'attrs'].includes(key))))) return false;
        if (node.content !== undefined) {
            if (!Array.isArray(node.content)) return false;
            for (const child of node.content) {
                if (!record(child)) return false;
                pending.push({ node: child, depth: depth + 1 });
            }
        }
    }
    return true;
}

export const bodySchema = z.custom<ProseMirrorDocument>(value => {
    if (!isDocument(value)) return false;
    try { return JSON.stringify(value).length <= 30000; }
    catch { return false; }
}, '正文必须是 type=doc 的 ProseMirror JSON 文档，最多 30000 字符、节点最多嵌套 64 层');

export const parseBody = (value: string | null): ProseMirrorDocument | null => value === null ? null : JSON.parse(value);

// Compare the stored JSON inside the UPDATE so concurrent edits cannot stale the comparison.
// Object key order and whitespace are immaterial; array order remains part of the content.
export function jsonChanged(column: SQL, value: string | null): SQL {
    const entries = (expression: SQL) => sql`SELECT fullkey,
        CASE WHEN type IN ('integer','real') THEN 'number' ELSE type END AS kind,atom FROM json_tree(${expression})`;
    return sql`(EXISTS(${entries(column)} EXCEPT ${entries(sql`${value}`)})
        OR EXISTS(${entries(sql`${value}`)} EXCEPT ${entries(column)}))`;
}