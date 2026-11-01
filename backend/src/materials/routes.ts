import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { prepareStatement } from '../db/index.ts';
import { contentDto, editContent, publicSelect, rawContent, requireEditor } from '../discussions/service.ts';
import { type AppEnv, type PublicRow } from '../discussions/types.ts';
import { HttpError, listResult, page, parsedEnum, queryPage, respond } from '../http.ts';
import { editPermission, requireManagement } from '../permissions.ts';
import { courseIdentity, materialContent, materialDetail, selectedVersion, versionDto, versionPage, withMaterialVersions } from './service.ts';
import { materialId, materialMimes, maxBytes, now, versionNumber } from './validation.ts';
import { serveMaterialFile } from './files.ts';

export const materialRoutes = new Hono<AppEnv>();
materialRoutes.get('/courses/:id/contents', async c => {
    const courseId = await courseIdentity(c, c.req.param('id')), p = page(c);
    const kind = parsedEnum(c.req.query('kind'), ['all', 'question', 'material'] as const, 'all');
    const state = parsedEnum(c.req.query('state'), ['all', 'unresolved', 'solved'] as const, 'all');
    const sort = parsedEnum(c.req.query('sort'), ['newest', 'active', 'score'] as const, 'active');
    if (kind !== 'question' && (state !== 'all' || sort === 'score')) throw new HttpError(400, 'INVALID_FILTER', '解决状态与净赞数排序仅适用于问题');
    const tag = c.req.query('tag')?.trim();
    if (tag && Array.from(tag).length > 30) throw new HttpError(400, 'INVALID_FILTER', '标签最长30字');
    const order = sort === 'score' ? sql`score DESC,c.created_at DESC,c.id ASC` : sort === 'newest' ? sql`c.created_at DESC,c.id ASC`
        : sql`(WITH RECURSIVE activity(id,updated_at) AS (
            SELECT id,updated_at FROM accessible_contents WHERE id=c.id
            UNION ALL SELECT child.id,child.updated_at FROM accessible_contents child JOIN activity parent ON child.target_id=parent.id
        ) SELECT MAX(updated_at) FROM activity) DESC,c.id ASC`;
    const { rows, total } = await queryPage<PublicRow>(c, p, sql`${publicSelect(c)} WHERE c.course_id=${courseId}
        AND c.kind IN ('question','material') ${kind === 'all' ? sql`` : sql`AND c.kind=${kind}`}
        ${state === 'solved' ? sql`AND accepted.answer_id IS NOT NULL` : state === 'unresolved' ? sql`AND accepted.answer_id IS NULL` : sql``}
        ${tag ? sql`AND EXISTS(SELECT 1 FROM json_each(c.tags) WHERE value=${tag})` : sql``} ORDER BY ${order}`);
    return respond(c, listResult(await withMaterialVersions(c, rows.map(contentDto)), p, total));
});
materialRoutes.get('/materials/policy', c => respond(c, { maxBytes: maxBytes(c.env), mimeTypes: [...materialMimes],
    filesPerVersion: 1, fileAccessRequiresLogin: true, uploadUrlLifetimeSeconds: 600, uploadLifetimeSeconds: 86400 }));
materialRoutes.get('/materials/:id', async c => respond(c, await materialDetail(c, c.req.param('id'),
    c.req.query('version') === undefined ? undefined : versionNumber(c.req.query('version')))));
materialRoutes.patch('/materials/:id', async c => {
    const id = materialId(c.req.param('id'));
    await editContent(c, id, 'material');
    return respond(c, await materialDetail(c, id));
});
materialRoutes.get('/materials/:id/versions', async c => {
    const content = await materialContent(c, c.req.param('id'));
    return respond(c, await versionPage(c, content.id, page(c)));
});
materialRoutes.get('/materials/:id/versions/:version', async c => {
    const content = await materialContent(c, c.req.param('id'));
    return respond(c, { materialId: content.id, title: content.title!, ...versionDto((await selectedVersion(c, content.id, versionNumber(c.req.param('version'))))!) });
});
materialRoutes.get('/materials/:id/versions/:version/preview', c => serveMaterialFile(c, true));
materialRoutes.on('HEAD', '/materials/:id/versions/:version/preview', c => serveMaterialFile(c, true));
materialRoutes.get('/materials/:id/versions/:version/download', c => serveMaterialFile(c, false));
materialRoutes.on('HEAD', '/materials/:id/versions/:version/download', c => serveMaterialFile(c, false));
materialRoutes.get('/moderation/materials/:id/versions', async c => {
    const content = await rawContent(c, materialId(c.req.param('id')), 'material');
    await requireManagement(c, content.course_id);
    return respond(c, await versionPage(c, content.id, page(c)));
});
materialRoutes.delete('/materials/:id/versions/:version', async c => {
    const content = await rawContent(c, materialId(c.req.param('id')), 'material'), a = await requireEditor(c, content);
    if (content.status === 'deleted') throw new HttpError(409, 'DELETED_CONTENT', '已删除资料不能维护版本');
    const version = versionNumber(c.req.param('version'));
    const allowed = sql`material_id=${content.id} AND version=${version} AND EXISTS(SELECT 1 FROM contents m
        WHERE m.id=file_versions.material_id AND m.kind='material' AND m.status<>'deleted'
        AND ${editPermission(a, sql`m.course_id`, sql`m.author_id`)})`;
    const result = await c.env.DB.batch<{ storage_key: string }>([
        sql`UPDATE file_versions SET updated_by=${a.id} WHERE ${allowed}`,
        sql`UPDATE contents SET updated_at=${now()},updated_by=${a.id} WHERE id=${content.id}
            AND EXISTS(SELECT 1 FROM file_versions WHERE ${allowed})`,
        sql`UPDATE material_upload_sessions SET cleaned_at=NULL WHERE material_id=${content.id} AND result_version=${version}
            AND status='published' AND EXISTS(SELECT 1 FROM file_versions WHERE ${allowed})`,
        sql`DELETE FROM file_versions WHERE ${allowed} AND updated_by=${a.id} RETURNING storage_key`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    const deleted = result[3]!.results[0];
    if (!deleted) throw new HttpError(404, 'FILE_VERSION_UNAVAILABLE', '文件版本不存在或维护权限已改变');
    // The database deletion closes access first; scheduled cleanup retries an unavailable R2 deletion.
    await c.env.FILES.delete(deleted.storage_key).catch(() => {
        console.error('Material file cleanup deferred', c.get('requestId'));
    });
    return respond(c, { materialId: content.id, version, deleted: true });
});