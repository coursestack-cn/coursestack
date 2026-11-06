import { bodySearchText } from '../search/text.ts';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { CONTENT_REQUEST_MAX_BYTES } from '../../../shared/rich-text/index.ts';
import { actor } from '../auth/middleware.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
import { requireEditor } from '../discussions/service.ts';
import { type AppEnv, type Ctx } from '../discussions/types.ts';
import { HttpError, input, requestIdentity, respond } from '../http.ts';
import { activeUser, editPermission } from '../permissions.ts';
import { courseIdentity, materialContent } from './service.ts';
import { objectKeys, receiveFile, requireStorage, sealFile, uploadTicket } from './storage.ts';
import { materialId, maxBytes, newId, now, uploadInput } from './validation.ts';

export type UploadRow = {
    id: string; owner_id: string; course_id: string; material_id: string; mode: 'create' | 'version';
    creation_draft: string | null; expected_size: number; mime: string;
    status: 'pending' | 'confirming' | 'published' | 'cancelled' | 'expired'; result_version: number | null;
    lease_token: string | null; lease_until: number | null; put_expires_at: number; expires_at: number;
    created_at: number; cleaned_at: number | null; request_key: string; request_hash: string;
};
export async function ownUpload(c: Ctx, id: string) {
    const a = actor(c);
    const row = await createDatabase(c.env.DB).get<UploadRow>(sql`SELECT * FROM material_upload_sessions WHERE id=${materialId(id)} AND owner_id=${a.id}`);
    if (!row) throw new HttpError(404, 'UPLOAD_NOT_FOUND', '上传记录不存在');
    return row;
}
export function uploadStatus(row: UploadRow) {
    return { uploadId: row.id, status: ['pending', 'confirming'].includes(row.status) && row.expires_at <= now() ? 'expired' : row.status,
        expiresAt: row.expires_at, result: row.status === 'published' ? { materialId: row.material_id, version: row.result_version! } : null };
}
function requirePending(row: UploadRow) {
    if (row.expires_at <= now() || row.status === 'expired') throw new HttpError(410, 'UPLOAD_EXPIRED', '上传记录已过期，请重新申请');
    if (row.status !== 'pending') throw new HttpError(409, 'UPLOAD_STATE_CONFLICT', '上传正在处理或已结束');
}
async function checkTarget(c: Ctx, row: UploadRow) {
    if (row.mode === 'version') await requireEditor(c, await materialContent(c, row.material_id));
    else await courseIdentity(c, row.course_id);
}
export const materialUploadRoutes = new Hono<AppEnv>();
materialUploadRoutes.post('/material-uploads', async c => {
    const a = actor(c), data = await input(c, uploadInput, CONTENT_REQUEST_MAX_BYTES);
    if (data.file.size > maxBytes(c.env)) throw new HttpError(413, 'FILE_TOO_LARGE', '文件超过上传大小限制');
    requireStorage(c.env);
    const identity = await requestIdentity(c, data), db = createDatabase(c.env.DB);
    let row = await db.get<UploadRow>(sql`SELECT * FROM material_upload_sessions WHERE owner_id=${a.id} AND request_key=${identity.key}`);
    if (!row) {
        let courseId: string, id: string;
        if (data.mode === 'version') {
            const content = await materialContent(c, data.materialId);
            await requireEditor(c, content); courseId = content.course_id; id = content.id;
        } else { courseId = await courseIdentity(c, data.courseId); id = newId(); }
        const at = now(), uploadId = newId();
        const creationDraft = data.mode === 'create' ? JSON.stringify({ title: data.title, body: data.body, tags: data.tags?.length ? data.tags : null }) : null;
        await db.run(sql`INSERT INTO material_upload_sessions(id,owner_id,course_id,material_id,mode,creation_draft,expected_size,mime,
            put_expires_at,expires_at,created_at,request_key,request_hash)
            SELECT ${uploadId},${a.id},${courseId},${id},${data.mode},${creationDraft},${data.file.size},${data.file.type},
                ${at + 600},${at + 86400},${at},${identity.key},${identity.fingerprint} WHERE ${activeUser(a)}
            ON CONFLICT(owner_id,request_key) DO NOTHING`);
        row = await db.get<UploadRow>(sql`SELECT * FROM material_upload_sessions WHERE owner_id=${a.id} AND request_key=${identity.key}`);
        if (row && row.id !== uploadId) c.header('Idempotency-Replayed', 'true');
    } else c.header('Idempotency-Replayed', 'true');
    if (!row) throw new HttpError(409, 'STATE_CONFLICT', '上传条件已改变');
    if (row.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    if (row.status === 'published') return respond(c, uploadStatus(row), 201);
    requirePending(row); await checkTarget(c, row);
    const at = now(), expiresAt = Math.min(at + 600, row.expires_at);
    const changed = await db.run(sql`UPDATE material_upload_sessions SET put_expires_at=MAX(put_expires_at,${expiresAt})
        WHERE id=${row.id} AND status='pending' AND expires_at>${at} AND ${activeUser(a)}`);
    if (!changed.meta.changes) throw new HttpError(409, 'UPLOAD_STATE_CONFLICT', '上传状态已改变');
    return respond(c, { ...await uploadTicket(c.env, new URL(c.req.url).origin, row.id, row.expected_size, row.mime, expiresAt, at), status: 'pending' as const }, 201);
});
materialUploadRoutes.get('/material-uploads/:id', async c => respond(c, uploadStatus(await ownUpload(c, c.req.param('id')))));
materialUploadRoutes.delete('/material-uploads/:id', async c => {
    const row = await ownUpload(c, c.req.param('id')), a = actor(c), at = now();
    if (row.status === 'published') throw new HttpError(409, 'UPLOAD_ALREADY_PUBLISHED', '资料已发布，请使用资料管理操作');
    const result = await createDatabase(c.env.DB).run(sql`UPDATE material_upload_sessions SET status='cancelled',creation_draft=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=${row.id} AND status<>'published' AND (lease_until IS NULL OR lease_until<${at}) AND ${activeUser(a)}`);
    if (!result.meta.changes) throw new HttpError(409, 'UPLOAD_BUSY', '正在确认发布，请稍后查询上传结果');
    return respond(c, uploadStatus(await ownUpload(c, row.id)));
});
materialUploadRoutes.put('/local/material-uploads/:id/file', async c => {
    if (c.env.APP_ENV !== 'local') throw new HttpError(404, 'NOT_FOUND', '接口不存在');
    const row = await ownUpload(c, c.req.param('id'));
    requirePending(row); await checkTarget(c, row);
    if (row.put_expires_at <= now()) throw new HttpError(410, 'UPLOAD_EXPIRED', '上传地址已过期');
    if (c.req.header('Content-Type') !== row.mime) throw new HttpError(415, 'UPLOAD_TYPE_MISMATCH', '文件类型与上传申请不一致');
    const length = c.req.header('Content-Length');
    if (length !== undefined && Number(length) !== row.expected_size) throw new HttpError(400, 'UPLOAD_SIZE_MISMATCH', '文件大小与上传申请不一致');
    if (!c.req.raw.body) throw new HttpError(400, 'UPLOAD_EMPTY', '文件内容不能为空');
    await receiveFile(c.env.FILES, objectKeys(row.id).staging, c.req.raw.body, row.expected_size, row.mime);
    const current = await ownUpload(c, row.id);
    if (['cancelled', 'expired'].includes(current.status) || current.expires_at <= now()) {
        await c.env.FILES.delete(objectKeys(row.id).staging);
        throw new HttpError(409, 'UPLOAD_STATE_CONFLICT', '上传已取消或过期');
    }
    return c.body(null, 204);
});
materialUploadRoutes.post('/material-uploads/:id/confirm', async c => {
    const row = await ownUpload(c, c.req.param('id')), a = actor(c);
    if (row.status === 'published') return respond(c, uploadStatus(row).result!);
    if (row.status === 'confirming' && (row.lease_until ?? 0) >= now()) throw new HttpError(409, 'UPLOAD_BUSY', '正在确认发布，请稍后查询上传结果');
    if (row.status !== 'confirming') requirePending(row);
    if (row.expires_at <= now()) throw new HttpError(410, 'UPLOAD_EXPIRED', '上传记录已过期');
    await checkTarget(c, row);
    const db = createDatabase(c.env.DB), lease = newId(), at = now();
    const claimed = await db.run(sql`UPDATE material_upload_sessions SET status='confirming',lease_token=${lease},lease_until=${at + 300}
        WHERE id=${row.id} AND expires_at>${at} AND (status='pending' OR (status='confirming' AND lease_until<${at})) AND ${activeUser(a)}`);
    if (!claimed.meta.changes) {
        const current = await ownUpload(c, row.id);
        if (current.status === 'published') return respond(c, uploadStatus(current).result!);
        throw new HttpError(409, 'UPLOAD_BUSY', '上传状态已改变，请查询上传结果');
    }
    try {
        const key = await sealFile(c.env, row.id, row.expected_size, row.mime), finishedAt = now();
        const gate = sql`u.id=${row.id} AND u.owner_id=${a.id} AND u.status='confirming' AND u.lease_token=${lease}
            AND u.lease_until>=${finishedAt} AND u.expires_at>${finishedAt} AND ${activeUser(a)}`;
        await c.env.DB.batch([
            sql`INSERT INTO contents(id,kind,course_id,term_id,author_id,title,body,body_text,tags,updated_by,created_at,updated_at,request_key,request_hash)
                SELECT u.material_id,'material',u.course_id,(SELECT id FROM terms WHERE current=1),u.owner_id,json_extract(u.creation_draft,'$.title'),json_extract(u.creation_draft,'$.body'),
                    ${bodySearchText(row.creation_draft ? JSON.parse(row.creation_draft).body : null)},json_extract(u.creation_draft,'$.tags'),${a.id},${finishedAt},${finishedAt},'material-upload:'||u.id,u.request_hash
                FROM material_upload_sessions u WHERE ${gate} AND u.mode='create' ON CONFLICT(author_id,request_key) DO NOTHING`,
            sql`INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by,created_at)
                SELECT u.material_id,COALESCE(counter.next_version,1),${key},u.expected_size,u.mime,${a.id},${a.id},${finishedAt}
                FROM material_upload_sessions u JOIN contents m ON m.id=u.material_id AND m.kind='material' AND m.status<>'deleted' AND m.course_id=u.course_id
                LEFT JOIN material_next_versions counter ON counter.material_id=m.id WHERE ${gate} AND ${editPermission(a, sql`m.course_id`, sql`m.author_id`)}
                ON CONFLICT(storage_key) DO NOTHING`,
            sql`UPDATE contents SET updated_at=${finishedAt},updated_by=${a.id} WHERE id=${row.material_id}
                AND EXISTS(SELECT 1 FROM material_upload_sessions u JOIN file_versions f ON f.storage_key=${key} AND f.material_id=u.material_id WHERE ${gate})`,
            sql`UPDATE material_upload_sessions SET status='published',creation_draft=NULL,result_version=(SELECT version FROM file_versions WHERE storage_key=${key}),
                lease_token=NULL,lease_until=NULL WHERE id IN (SELECT u.id FROM material_upload_sessions u JOIN file_versions f
                    ON f.storage_key=${key} AND f.material_id=u.material_id WHERE ${gate})`,
        ].map(statement => prepareStatement(c.env.DB, statement)));
        const current = await ownUpload(c, row.id);
        if (current.status !== 'published') throw new HttpError(409, 'STATE_CONFLICT', '发布条件已改变，请重试确认');
        return respond(c, uploadStatus(current).result!);
    } catch (error) {
        // Keep a sealed object for retries; a lost database response must never erase a published file.
        await db.run(sql`UPDATE material_upload_sessions SET status='pending',lease_token=NULL,lease_until=NULL
            WHERE id=${row.id} AND status='confirming' AND lease_token=${lease}`).catch(() => {});
        throw error;
    }
});