import type { Env } from '../env.ts';
import { HttpError, json, requireSameOrigin } from '../http.ts';
import { requireSession } from '../auth/service.ts';
import { mutateAccount } from './mutations.ts';
import { accountDetail } from './service.ts';

async function removeUnusedAvatar(env: Env, key: string) {
    if (await env.DB.prepare('SELECT 1 FROM accounts WHERE avatar_key = ?').bind(key).first()) return;
    await env.FILES.delete(key);
    await env.DB.prepare('DELETE FROM avatar_objects WHERE object_key = ?').bind(key).run();
}

/** Delayed reconciliation also covers interrupted uploads and failed R2 deletes. */
export async function cleanupAvatars(env: Env) {
    const rows = await env.DB.prepare(`SELECT object_key FROM avatar_objects
        WHERE created_at < unixepoch() - 3600 AND NOT EXISTS (SELECT 1 FROM accounts WHERE avatar_key = object_key)
        LIMIT 100`).all<{ object_key: string }>();
    for (const row of rows.results) await removeUnusedAvatar(env, row.object_key);
    return rows.results.length;
}

function imageType(bytes: Uint8Array): string {
    const start = Array.from(bytes.slice(0, 12));
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => start[i] === b) && bytes.length >= 33) return 'image/png';
    if (start[0] === 255 && start[1] === 216 && start[2] === 255 && bytes.length >= 4 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg';
    if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP' && bytes.length >= 20) return 'image/webp';
    throw new HttpError(415, 'INVALID_AVATAR', '头像仅支持 PNG、JPEG 或 WebP 图片');
}

async function imageBody(request: Request) {
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'EMPTY_AVATAR', '请选择头像');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new HttpError(413, 'AVATAR_TOO_LARGE', '头像不能超过 2 MiB'); }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

export async function avatarRoutes(request: Request, env: Env): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    const publicAvatar = path.match(/^\/api\/profiles\/([^/]+)\/avatar$/);
    if (!publicAvatar && path !== '/api/me/avatar') return null;
    const allowed = publicAvatar ? ['GET'] : ['PUT', 'DELETE'];
    if (!allowed.includes(request.method)) return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } }, 405, { Allow: allowed.join(', ') });
    if (publicAvatar) {
        const row = await env.DB.prepare("SELECT avatar_key FROM accounts WHERE id = ? AND status = 'active'").bind(decodeURIComponent(publicAvatar[1])).first<{ avatar_key: string | null }>();
        const object = row?.avatar_key ? await env.FILES.get(row.avatar_key) : null;
        if (!object) throw new HttpError(404, 'AVATAR_NOT_FOUND', '头像不存在');
        return new Response(object.body, { headers: {
            'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cache-Control': 'no-store',
        } });
    }
    requireSameOrigin(request);
    const session = await requireSession(env.DB, request);
    const rawRevision = request.headers.get('if-match')?.match(/^"([1-9][0-9]*)"$/)?.[1];
    if (!rawRevision || !Number.isSafeInteger(Number(rawRevision))) throw new HttpError(428, 'REVISION_REQUIRED', 'If-Match 需要带引号的账号 revision');
    const current = await env.DB.prepare('SELECT avatar_key, revision FROM accounts WHERE id = ?').bind(session.id).first<{ avatar_key: string | null; revision: number }>();
    if (!current || current.revision !== Number(rawRevision)) throw new HttpError(409, 'ACCOUNT_CHANGED', '账号已变化，请刷新后重试');
    let key: string | null = null;
    if (request.method === 'PUT') {
        const bytes = await imageBody(request);
        const contentType = imageType(bytes);
        if (request.headers.get('content-type')?.split(';')[0] !== contentType) throw new HttpError(415, 'AVATAR_TYPE_MISMATCH', '头像内容与类型不符');
        key = `avatars/${session.id}/${crypto.randomUUID()}`;
        await env.DB.prepare('INSERT INTO avatar_objects (object_key) VALUES (?)').bind(key).run();
        await env.FILES.put(key, bytes, { httpMetadata: { contentType } });
    }
    try {
        await mutateAccount(env.DB, session, session.id, Number(rawRevision), 'profile.avatar', ['avatar'], false,
            (gate) => [env.DB.prepare(`UPDATE accounts SET avatar_key = ? WHERE id = ? AND ${gate}`).bind(key, session.id)]);
    } catch (error) {
        if (key) {
            try { await removeUnusedAvatar(env, key); } catch { /* Durable registry retains cleanup work. */ }
        }
        throw error;
    }
    // The public route resolves only the current database key; old objects are never public.
    if (current.avatar_key) {
        try { await removeUnusedAvatar(env, current.avatar_key); } catch { /* Cleanup failure must not misreport a committed profile update. */ }
    }
    return json({ data: await accountDetail(env.DB, session.id) });
}