import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, assertChanged, input, listResult, page, requestIdentity, parsedEnum, queryPage } from '../http.ts';
import { management, activeUser, requireManagement } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import { contentBranch, cleanupDeletedFiles } from '../discussions/deletion.ts';
import { type AppEnv, type PublicRow } from '../discussions/types.ts';
import { contentDto, publicSelect, rawContent, visibleContent } from '../discussions/service.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();
// Reasons are optional everywhere; an omitted or blank reason is stored as an empty string.
export const reasonSchema = z.string().trim().refine(value => Array.from(value).length <= 1000, '理由最多1000个字符').default('');

type Report = { id: string; content_id: string; reporter_id: string; reason: string; status: string;
    created_at: number; resolution: string | null; handled_by: string | null;
    handled_at: number | null; course_id: string; request_hash: string };
const reportDto = (r: Report) => ({ id: r.id, contentId: r.content_id, reporterId: r.reporter_id, reason: r.reason,
    status: r.status, createdAt: r.created_at, resolution: r.resolution,
    handledBy: r.handled_by, handledAt: r.handled_at, courseId: r.course_id });
export const moderationRoutes = new Hono<AppEnv>();
moderationRoutes.post('/contents/:id/reports', async c => {
    const a = actor(c), target = await visibleContent(c, c.req.param('id'));
    const data = await input(c, z.object({ reason: reasonSchema }).strict());
    const identity = await requestIdentity(c, data), id = uid();
    const previous = await createDatabase(c.env.DB).get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM reports
        WHERE reporter_id=${a.id} AND request_key=${identity.key}`);
    if (previous) {
        if (previous.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
        c.header('Idempotency-Replayed', 'true'); return respond(c, { id: previous.id }, 201);
    }
    const pending = await createDatabase(c.env.DB).get(sql`SELECT 1 FROM reports WHERE content_id=${target.id} AND reporter_id=${a.id} AND status='pending'`);
    if (pending) throw new HttpError(409, 'REPORT_ALREADY_PENDING', '该内容已有你的待处理举报');
    await createDatabase(c.env.DB).run(sql`INSERT INTO reports(id,content_id,reporter_id,reason,created_at,request_key,request_hash)
        SELECT ${id},id,${a.id},${data.reason},${now()},${identity.key},${identity.fingerprint} FROM public_contents
        WHERE id=${target.id} AND ${activeUser(a)} ON CONFLICT DO NOTHING`);
    const made = await createDatabase(c.env.DB).get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM reports WHERE reporter_id=${a.id} AND request_key=${identity.key}`);
    if (!made) throw new HttpError(409, 'REPORT_CONFLICT', '举报已存在或目标状态已变化');
    if (made.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    return respond(c, { id: made.id }, 201);
});
moderationRoutes.get('/moderation/reports', async c => {
    const a = actor(c), p = page(c), courseId = c.req.query('courseId');
    if (!['teacher', 'admin'].includes(a.role)) throw new HttpError(403, 'REVIEWER_REQUIRED', '需要课程教师或管理员权限');
    if (courseId) await requireManagement(c, courseId);
    const status = parsedEnum(c.req.query('status'), ['pending', 'resolved', 'dismissed', 'deleted', 'all'] as const, 'pending');
    const { rows, total } = await queryPage<Report>(c, p, sql`SELECT r.*,t.course_id FROM reports r JOIN contents t ON t.id=r.content_id
        WHERE ${management(a, sql`t.course_id`)} ${courseId ? sql`AND t.course_id=${courseId}` : sql``}
        ${status === 'all' ? sql`` : sql`AND r.status=${status}`} ORDER BY r.created_at ASC,r.id ASC`);
    return respond(c, listResult(rows.map(reportDto), p, total));
});
moderationRoutes.patch('/moderation/reports/:id', async c => {
    const a = actor(c), id = c.req.param('id');
    const report = await createDatabase(c.env.DB).get<Report>(sql`SELECT r.*,t.course_id FROM reports r JOIN contents t ON t.id=r.content_id WHERE r.id=${id}`);
    if (!report) throw new HttpError(404, 'REPORT_NOT_FOUND', '举报不存在');
    await requireManagement(c, report.course_id);
    const data = await input(c, z.object({ action: z.enum(['none', 'hide', 'delete']), resolution: reasonSchema }).strict());
    const target = await rawContent(c, report.content_id);
    if (data.action !== 'none' && target.status === 'deleted') throw new HttpError(409, 'DELETED_CONTENT', '内容已删除，请选择维持现状');
    const at = now(), desired = data.action === 'delete' ? 'deleted' : 'hidden';
    const status = data.action === 'none' ? 'dismissed' : data.action === 'delete' ? 'deleted' : 'resolved';
    const gate = sql`id=${report.content_id} AND status<>'deleted' AND ${management(a, sql`contents.course_id`)}
        AND EXISTS(SELECT 1 FROM reports WHERE id=${id} AND status='pending')`;
    const statements = data.action === 'none' ? [] : moderationStatements(report.content_id, a.id, desired, data.resolution, at, gate);
    const results = await c.env.DB.batch<{ storage_key: string }>([
        ...statements,
        sql`UPDATE reports SET status=${status},resolution=${data.resolution},handled_by=${a.id},handled_at=${at}
            WHERE id=${id} AND status='pending' AND EXISTS(SELECT 1 FROM contents t WHERE t.id=reports.content_id
              AND ${management(a, sql`t.course_id`)} ${data.action !== 'none' ? sql`AND t.status=${desired}` : sql``})`,
    ].map(s => prepareStatement(c.env.DB, s)));
    assertChanged(results.at(-1)!);
    if (data.action === 'delete') await cleanupDeletedFiles(c, results[0]!.results);
    return respond(c, { id, status });
});
moderationRoutes.get('/moderation/contents', async c => {
    const a = actor(c), p = page(c), courseId = c.req.query('courseId'), termId = c.req.query('termId');
    if (!['teacher', 'admin'].includes(a.role)) throw new HttpError(403, 'REVIEWER_REQUIRED', '需要课程教师或管理员权限');
    if (courseId) await requireManagement(c, courseId);
    const status = parsedEnum(c.req.query('status'), ['visible', 'hidden', 'deleted', 'all'] as const, 'hidden');
    const kind = parsedEnum(c.req.query('kind'), ['material', 'question', 'answer', 'comment'] as const);
    const { rows, total } = await queryPage<PublicRow>(c, p, sql`${publicSelect(c, false, sql`contents`)}
        WHERE ${management(a, sql`c.course_id`)} ${courseId ? sql`AND c.course_id=${courseId}` : sql``}
        ${status === 'all' ? sql`` : status === 'hidden' ? sql`AND c.status<>'deleted' AND c.id NOT IN (SELECT id FROM public_contents)` : status === 'visible' ? sql`AND c.id IN (SELECT id FROM public_contents)` : sql`AND c.status='deleted'`} ${kind ? sql`AND c.kind=${kind}` : sql``}
        ${termId ? sql`AND c.term_id=${termId}` : sql``} ORDER BY c.updated_at DESC,c.id ASC`);
    return respond(c, listResult(rows.map(contentDto), p, total));
});
moderationRoutes.get('/moderation/contents/:id', async c => {
    const a = actor(c);
    const row = await createDatabase(c.env.DB).get<PublicRow>(sql`${publicSelect(c, false, sql`contents`)}
        WHERE c.id=${c.req.param('id')} AND ${management(a, sql`c.course_id`)}`);
    if (!row) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或无审查权限');
    const actions = await createDatabase(c.env.DB).all(sql`SELECT id,version,actor_id AS actorId,old_status AS oldStatus,
        new_status AS newStatus,reason,created_at AS createdAt FROM moderation_actions WHERE content_id=${row.id} ORDER BY id DESC`);
    return respond(c, { ...contentDto(row), actions });
});
function moderationStatements(id: string, actorId: string, desired: 'visible' | 'hidden' | 'deleted', reason: string, at: number, allowed: ReturnType<typeof sql>) {
    const gate = sql`${allowed} AND status<>${desired}`;
    return [
        sql`SELECT storage_key FROM file_versions WHERE material_id=${id} AND ${desired}='deleted'
            AND EXISTS(SELECT 1 FROM contents WHERE ${gate})`,
        sql`INSERT INTO moderation_actions(content_id,actor_id,old_status,new_status,reason,created_at)
            SELECT c.id,${actorId},c.status,${desired},${reason},${at} FROM contents c
            WHERE c.status<>'deleted' AND EXISTS(SELECT 1 FROM contents WHERE ${gate})
              AND c.id IN (${contentBranch(id, desired !== 'deleted')})`,
        sql`UPDATE contents SET status=${desired},title=CASE WHEN ${desired}='deleted' THEN NULL ELSE title END,
            body=CASE WHEN ${desired}='deleted' THEN NULL ELSE body END,tags=CASE WHEN ${desired}='deleted' THEN NULL ELSE tags END,
            updated_at=${at},updated_by=${actorId} WHERE ${gate}`,
    ];
}
moderationRoutes.put('/contents/:id/moderation', async c => {
    const row = await rawContent(c, c.req.param('id')), a = await requireManagement(c, row.course_id);
    const data = await input(c, z.object({ action: z.enum(['hide', 'restore', 'delete']), reason: reasonSchema }).strict());
    if (row.status === 'deleted') throw new HttpError(409, 'DELETED_CONTENT', '已删除内容不能再次处理或恢复');
    const desired = data.action === 'delete' ? 'deleted' : data.action === 'hide' ? 'hidden' : 'visible', at = now();
    const allowed = sql`id=${row.id} AND status<>'deleted' AND ${management(a, sql`contents.course_id`)}`;
    const result = await c.env.DB.batch<{ storage_key: string }>([
        ...moderationStatements(row.id, a.id, desired, data.reason, at, allowed),
        sql`SELECT id FROM contents WHERE id=${row.id} AND status=${desired} AND ${management(a, sql`contents.course_id`)}`,
    ].map(s => prepareStatement(c.env.DB, s)));
    if (!result[3]!.results.length) assertChanged(result[2]!);
    if (desired === 'deleted') await cleanupDeletedFiles(c, result[0]!.results);
    return respond(c, { id: row.id, status: desired, changed: result[2]!.meta.changes > 0 });
});
moderationRoutes.get('/moderation/actions', async c => {
    const a = actor(c), p = page(c), courseId = c.req.query('courseId');
    if (!['teacher', 'admin'].includes(a.role)) throw new HttpError(403, 'REVIEWER_REQUIRED', '需要课程教师或管理员权限');
    if (courseId) await requireManagement(c, courseId);
    const { rows, total } = await queryPage<{ id: number; contentId: string; actorId: string; oldStatus: string; newStatus: string; reason: string; createdAt: number }>(c, p, sql`
        SELECT m.id,m.version,m.content_id AS contentId,m.actor_id AS actorId,m.old_status AS oldStatus,m.new_status AS newStatus,m.reason,m.created_at AS createdAt
        FROM moderation_actions m JOIN contents t ON t.id=m.content_id WHERE ${management(a, sql`t.course_id`)}
        ${courseId ? sql`AND t.course_id=${courseId}` : sql``} ORDER BY m.id DESC`);
    return respond(c, listResult(rows, p, total));
});