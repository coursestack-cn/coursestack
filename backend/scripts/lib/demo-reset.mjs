import { HttpError } from '../../src/http.ts';
import { prepareDemoData } from './demo-data.mjs';

// SQLite reserves sqlite_* and D1 keeps internal tables under _cf_*; neither can be dropped.
const objectsSql = `SELECT type, name FROM sqlite_master
    WHERE type IN ('table', 'view') AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'`;
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const r2Failed = (detail) => new HttpError(503, 'R2_OPERATION_FAILED',
    `R2 清理未确认成功（${detail}），请检查 Token 是否有账号级 Workers R2 Storage Write；未改动 D1，未自动重试`);
// Status and numeric Cloudflare error codes are safe to print; provider messages are not.
const r2Response = (method, response, payload) => {
    const codes = (Array.isArray(payload?.errors) ? payload.errors : []).map((error) => error?.code).filter(Number.isInteger);
    return r2Failed(`${method} HTTP ${response.status}${codes.length ? `，Cloudflare 错误 ${codes.join('、')}` : ''}`);
};

// Only the credential survives a reset; sessions, avatar and login history are dropped with the data.
export async function backupAdministrator(binding) {
    if (!await binding.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").first()) return null;
    return binding.prepare("SELECT id, nickname, password FROM accounts WHERE role = 'admin' AND password IS NOT NULL").first();
}

// Dropping every table also clears d1_migrations, so the current initialization SQL applies again.
// DROP TABLE skips row triggers, and deferred foreign keys let tables go in any order.
export async function dropDatabaseObjects(binding) {
    const [{ results }] = await binding.batch([binding.prepare(objectsSql)]);
    const ordered = [...results.filter((o) => o.type === 'view'), ...results.filter((o) => o.type === 'table')];
    if (!ordered.length) return 0;
    await binding.batch([
        binding.prepare('PRAGMA defer_foreign_keys=ON'),
        ...ordered.map((o) => binding.prepare(`DROP ${o.type === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS ${quote(o.name)}`)),
    ]);
    return ordered.length;
}

export async function clearBucket({ accountId, bucket, token }, request = fetch) {
    const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects`;
    const call = async (url, method) => {
        try {
            return await request(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}` } });
        } catch { throw r2Failed(`${method} 未收到响应`); }
    };
    // List everything first; deleting while paging would shift the cursor.
    const keys = [];
    let cursor;
    do {
        const response = await call(`${base}?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET');
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.success !== true || !Array.isArray(payload.result)) throw r2Response('GET', response, payload);
        keys.push(...payload.result.map((object) => object.key));
        cursor = payload.result_info?.is_truncated ? payload.result_info.cursor : undefined;
    } while (cursor);
    for (const key of keys) {
        const response = await call(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`, 'DELETE');
        if (!response.ok && response.status !== 404) throw r2Response('DELETE', response, await response.json().catch(() => null));
    }
    return keys.length;
}

// Callers provide migrate and seed so production runs Wrangler while tests use an isolated D1.
// R2 goes first so a token without R2 access fails before D1 or the admin credential is touched,
// and the admin returns as soon as the schema exists so a later seed failure cannot lose it.
export async function resetDemoData(binding, { clearFiles, migrate, seed }) {
    const administrator = await backupAdministrator(binding);
    const deletedFiles = await clearFiles();
    const droppedObjects = await dropDatabaseObjects(binding);
    await migrate();
    if (administrator) {
        await binding.batch([binding.prepare("INSERT INTO accounts (id, nickname, role, password) VALUES (?, ?, 'admin', ?)")
            .bind(administrator.id, administrator.nickname, administrator.password)]);
    }
    await seed();
    const demo = await prepareDemoData(binding);
    return { droppedObjects, deletedFiles, administratorId: administrator?.id ?? null, ...demo };
}