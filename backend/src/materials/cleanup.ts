import { sql } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { type Env } from '../env.ts';
import { objectKeys } from './storage.ts';
import { now } from './validation.ts';

export async function cleanupMaterialUploads(env: Env, at = now()) {
    const db = createDatabase(env.DB);
    await db.run(sql`UPDATE material_upload_sessions SET status='expired',creation_draft=NULL,lease_token=NULL,lease_until=NULL
        WHERE status IN ('pending','confirming') AND expires_at<${at} AND (lease_until IS NULL OR lease_until<${at})`);
    // Revisit old sessions: a PUT started before URL expiry can finish after an earlier cleanup.
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM material_upload_sessions
        WHERE status IN ('published','cancelled','expired') AND expires_at<${at - 3600}
        AND (cleaned_at IS NULL OR cleaned_at<${at - 86400}) ORDER BY COALESCE(cleaned_at,0),expires_at,id LIMIT 100`);
    for (const row of rows) {
        const keys = objectKeys(row.id);
        await env.FILES.delete(keys.staging);
        if (!await db.get(sql`SELECT 1 FROM file_versions WHERE storage_key=${keys.sealed}`)) {
            await env.FILES.delete(keys.sealed);
        }
        await db.run(sql`UPDATE material_upload_sessions SET cleaned_at=${at} WHERE id=${row.id}`);
    }
    return { cleaned: rows.length };
}