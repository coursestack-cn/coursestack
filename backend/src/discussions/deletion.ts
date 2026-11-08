import { sql, type SQL } from 'drizzle-orm';
import { type Ctx } from './types.ts';

// Hidden children count too. Reply references are deliberately absent from this ownership check.
export function ownerDeletionAllowed(id: SQL): SQL {
    return sql`NOT EXISTS(SELECT 1 FROM contents child WHERE child.target_id=${id} AND child.status<>'deleted')
        AND NOT EXISTS(SELECT 1 FROM acceptances WHERE answer_id=${id})`;
}
// Hiding and restoring pass openOnly: a child hidden on its own stays closed, along with everything below it.
export function contentBranch(id: string, openOnly = false): SQL {
    return sql`WITH RECURSIVE branch(id) AS (SELECT id FROM contents WHERE id=${id}
        UNION ALL SELECT child.id FROM contents child JOIN branch parent ON child.target_id=parent.id
        ${openOnly ? sql`WHERE child.status='visible'` : sql``})
        SELECT id FROM branch`;
}
export async function cleanupDeletedFiles(c: Ctx, rows: { storage_key: string }[]) {
    if (!rows.length) return;
    try { await c.env.FILES.delete(rows.map(row => row.storage_key)); }
    catch { console.error('Material file cleanup deferred', c.get('requestId')); }
}