import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, assertChanged, input, listResult, page, requestIdentity, revisionSchema, parsedEnum, queryPage } from '../http.ts';
import { management, activeUser, requireManagement } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv } from '../discussions/types.ts';
import { parseBody } from '../discussions/body.ts';
import { rawContent, visibleContent } from '../discussions/service.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();

type Report = { id: string; content_id: string; reporter_id: string; reason: string; status: string;
    revision: number; created_at: number; resolution: string | null; handled_by: string | null;
    handled_at: number | null; course_id: string; request_hash: string };
const reportDto = (r: Report) => ({ id: r.id, contentId: r.content_id, reporterId: r.reporter_id, reason: r.reason,
    status: r.status, revision: r.revision, createdAt: r.created_at, resolution: r.resolution,
    handledBy: r.handled_by, handledAt: r.handled_at, courseId: r.course_id });
export const moderationRoutes = new Hono<AppEnv>();
moderationRoutes.post('/contents/:id/reports', async c => {
    const a = actor(c), target = await visibleContent(c, c.req.param('id'));
    const data = await input(c, z.object({ reason: z.string().trim().min(3).max(1000) }).strict());
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
    const status = parsedEnum(c.req.query('status'), ['pending', 'resolved', 'dismissed', 'all'] as const, 'pending');
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
    const data = await input(c, z.object({ revision: revisionSchema, status: z.enum(['resolved', 'dismissed']),
        resolution: z.string().trim().min(3).max(1000) }).strict());
    const result = await createDatabase(c.env.DB).run(sql`UPDATE reports SET status=${data.status},resolution=${data.resolution},handled_by=${a.id},
        handled_at=${now()},revision=revision+1 WHERE id=${id} AND revision=${data.revision} AND status='pending'
        AND EXISTS(SELECT 1 FROM contents t WHERE t.id=reports.content_id AND ${management(a, sql`t.course_id`)})`);
    assertChanged(result); return respond(c, { id, status: data.status, revision: data.revision + 1 });
});
moderationRoutes.get('/moderation/contents/:id', async c => {
    const row = await rawContent(c, c.req.param('id'));
    await requireManagement(c, row.course_id);
    return respond(c, { id: row.id, kind: row.kind, courseId: row.course_id, authorId: row.author_id,
        title: row.title, body: parseBody(row.body), status: row.status, revision: row.revision,
        targetKind: row.target_kind, targetId: row.target_id,
        createdAt: row.created_at, updatedAt: row.updated_at });
});
moderationRoutes.put('/contents/:id/moderation', async c => {
    const row = await rawContent(c, c.req.param('id')), a = await requireManagement(c, row.course_id);
    const data = await input(c, z.object({ revision: revisionSchema, action: z.enum(['hide', 'restore']),
        reason: z.string().trim().min(3).max(1000) }).strict());
    if (row.status === 'deleted') throw new HttpError(409, 'DELETED_CONTENT', '作者已删除的内容不能恢复或下架');
    const desired = data.action === 'hide' ? 'hidden' : 'visible';
    if (row.status === desired) return respond(c, { id: row.id, status: desired, revision: row.revision, changed: false });
    const at = now(), gate = sql`id=${row.id} AND revision=${data.revision} AND status=${row.status}
        AND ${management(a, sql`contents.course_id`)}`;
    const result = await c.env.DB.batch([
        sql`INSERT INTO moderation_actions(content_id,actor_id,old_status,new_status,reason,created_at)
            SELECT id,${a.id},status,${desired},${data.reason},${at} FROM contents WHERE ${gate}`,
        sql`UPDATE contents SET status=${desired},revision=revision+1,updated_at=${at},updated_by=${a.id} WHERE ${gate}`,
    ].map(s => prepareStatement(c.env.DB, s)));
    assertChanged(result[1]); return respond(c, { id: row.id, status: desired, revision: data.revision + 1, changed: true });
});
moderationRoutes.get('/moderation/actions', async c => {
    const a = actor(c), p = page(c), courseId = c.req.query('courseId');
    if (!['teacher', 'admin'].includes(a.role)) throw new HttpError(403, 'REVIEWER_REQUIRED', '需要课程教师或管理员权限');
    if (courseId) await requireManagement(c, courseId);
    const { rows, total } = await queryPage<{ id: number; contentId: string; actorId: string; oldStatus: string; newStatus: string; reason: string; createdAt: number }>(c, p, sql`
        SELECT m.id,m.content_id AS contentId,m.actor_id AS actorId,m.old_status AS oldStatus,m.new_status AS newStatus,m.reason,m.created_at AS createdAt
        FROM moderation_actions m JOIN contents t ON t.id=m.content_id WHERE ${management(a, sql`t.course_id`)}
        ${courseId ? sql`AND t.course_id=${courseId}` : sql``} ORDER BY m.id DESC`);
    return respond(c, listResult(rows, p, total));
});