import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { BODY_IMAGE_MAX_BYTES, BODY_IMAGE_MIMES, BODY_IMAGE_PREFIX } from '../../shared/rich-text/images.ts';
import { actor } from './auth/middleware.ts';
import { createDatabase } from './db/index.ts';
import type { AppEnv } from './discussions/types.ts';
import type { Env } from './env.ts';
import { HttpError, assertChanged, respond } from './http.ts';
import { matchesFileHeader, newId } from './materials/validation.ts';
import { activeUser, management } from './permissions.ts';

const objectKey = (id: string) => `body-images/${id}`;
const unavailable = () => new HttpError(404, 'BODY_IMAGE_UNAVAILABLE', '正文图片不存在或不可访问');

async function imageBytes(request: Request, mime: string) {
    if (!BODY_IMAGE_MIMES.some(type => type === mime)) throw new HttpError(415, 'BODY_IMAGE_TYPE', '请选择 PNG、JPEG、GIF 或 WebP 图片');
    const tooLarge = () => new HttpError(413, 'BODY_IMAGE_TOO_LARGE', '单张正文图片最大为 1 MiB');
    if (Number(request.headers.get('content-length')) > BODY_IMAGE_MAX_BYTES) throw tooLarge();
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'EMPTY_BODY_IMAGE', '请选择图片');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > BODY_IMAGE_MAX_BYTES) { await reader.cancel(); throw tooLarge(); }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (!matchesFileHeader(bytes, mime)) throw new HttpError(415, 'BODY_IMAGE_TYPE', '图片内容与声明类型不符');
    return bytes;
}

export const bodyImageRoutes = new Hono<AppEnv>();
bodyImageRoutes.post('/body-images', async c => {
    const a = actor(c), mime = c.req.header('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const bytes = await imageBytes(c.req.raw, mime);
    const id = newId(), db = createDatabase(c.env.DB);
    // Register the key before writing any bytes, including writes whose response may be lost.
    assertChanged(await db.run(sql`INSERT INTO content_images(id,uploaded_by,cleanup_at)
        SELECT ${id},${a.id},unixepoch()+86400 WHERE ${activeUser(a)}`));
    await c.env.FILES.put(objectKey(id), bytes, { httpMetadata: { contentType: mime } });
    return respond(c, { src: BODY_IMAGE_PREFIX + id });
});

bodyImageRoutes.get('/body-images/:id', async c => {
    const id = c.req.param('id'), a = c.get('actor');
    const privateAccess = a ? sql`${activeUser(a)} AND (
        (i.content_id IS NULL AND i.uploaded_by=${a.id} AND (i.cleanup_at>unixepoch() OR EXISTS(
            SELECT 1 FROM material_upload_sessions u WHERE u.id=i.draft_upload_id AND u.expires_at>unixepoch() AND u.status IN ('pending','confirming'))))
        OR (c.status<>'deleted' AND (c.author_id=${a.id} OR ${management(a, sql`c.course_id`)})))` : sql`0`;
    const allowed = await createDatabase(c.env.DB).get(sql`SELECT 1 FROM content_images i LEFT JOIN contents c ON c.id=i.content_id
        WHERE i.id=${id} AND (EXISTS(SELECT 1 FROM public_contents p WHERE p.id=c.id) OR (${privateAccess}))`);
    if (!allowed) throw unavailable();
    const object = await c.env.FILES.get(objectKey(id));
    if (!object) throw unavailable();
    return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'Content-Length': String(object.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});

export async function cleanupBodyImages(env: Env, at = Math.floor(Date.now() / 1000)) {
    const db = createDatabase(env.DB);
    const due = await db.all<{ id: string }>(sql`UPDATE content_images SET cleanup_at=0 WHERE id IN (
        SELECT id FROM content_images WHERE cleanup_at<=${at} ORDER BY cleanup_at,id LIMIT 100) RETURNING id`);
    for (const { id } of due) {
        try {
            await env.FILES.delete(objectKey(id));
            await db.run(sql`DELETE FROM content_images WHERE id=${id} AND cleanup_at=0`);
        } catch {
            // Keep a due timestamp. The next run can retry without making the key attachable again.
            await db.run(sql`UPDATE content_images SET cleanup_at=MIN(unixepoch(),${at}) WHERE id=${id} AND cleanup_at=0`);
            console.warn('Body image cleanup will retry.');
        }
    }
}