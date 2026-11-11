import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../discussions/types.ts';
import type { Env } from '../env.ts';
import { HttpError, json, keepAlive, sameOrigin } from '../http.ts';
import { requireSession } from '../auth/service.ts';
import { mutateAccount } from './mutations.ts';
import { accountDetail } from './service.ts';

export async function removeUnusedAvatar(env: Env, key: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (await env.DB.prepare('SELECT 1 FROM accounts WHERE avatar_key = ?').bind(key).first()) return;
            await env.FILES.delete(key);
            return;
        } catch {
            if (attempt === 2) console.warn('Avatar cleanup failed after three attempts.');
        }
    }
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

export const avatarRoutes = new Hono<AppEnv>();

avatarRoutes.get('/profiles/:id/avatar', async c => {
    const row = await c.env.DB.prepare("SELECT avatar_key FROM accounts WHERE id = ? AND status = 'active'").bind(c.req.param('id')).first<{ avatar_key: string | null }>();
    const object = row?.avatar_key ? await c.env.FILES.get(row.avatar_key) : null;
    if (!object) throw new HttpError(404, 'AVATAR_NOT_FOUND', '头像不存在');
    return new Response(object.body, { headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'no-store',
    } });
});
avatarRoutes.put('/me/avatar', sameOrigin(c => replaceAvatar(c, true)));
avatarRoutes.delete('/me/avatar', sameOrigin(c => replaceAvatar(c, false)));

async function replaceAvatar(c: Ctx, upload: boolean) {
    const env = c.env, session = await requireSession(env.DB, c.req.raw);
    return keepAlive(c, (async () => {
        let key: string | null = null;
        try {
            if (upload) {
                const bytes = await imageBody(c.req.raw), contentType = imageType(bytes);
                if (c.req.header('content-type')?.split(';')[0] !== contentType) throw new HttpError(415, 'AVATAR_TYPE_MISMATCH', '头像内容与类型不符');
                key = `avatars/${session.id}/${crypto.randomUUID()}`;
                await env.FILES.put(key, bytes, { httpMetadata: { contentType } });
            }
            const result = await mutateAccount(env.DB, session, session.id, false, gate => [
                env.DB.prepare(`SELECT avatar_key FROM accounts WHERE id = ? AND ${gate}`).bind(session.id),
                env.DB.prepare(`UPDATE accounts SET avatar_key = ? WHERE id = ? AND ${gate}`).bind(key, session.id),
            ]);
            // Read the displaced key in the same transaction as the replacement:
            // concurrent uploads clean up the actual preceding avatar, not a stale one.
            const previous = (result[1].results[0] as { avatar_key: string | null } | undefined)?.avatar_key;
            if (previous) await removeUnusedAvatar(env, previous);
        } catch (error) {
            if (key) await removeUnusedAvatar(env, key);
            throw error;
        }
        return json({ data: await accountDetail(env.DB, session.id) });
    })());
}