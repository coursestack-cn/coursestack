import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError, activeUser, actor, assertChanged, db, input, listResult, management, now, page, parsedEnum,
  rawContent, requestIdentity, requireManagement, revisionSchema, uid, visibleContent, type AppEnv } from '../core';

type Report = { id: string; content_id: string; reporter_id: string; reason: string; status: string;
  revision: number; created_at: string; resolution: string | null; handled_by: string | null;
  handled_at: string | null; course_id: string; request_hash: string };
const reportDto = (r: Report) => ({ id: r.id, contentId: r.content_id, reporterId: r.reporter_id, reason: r.reason,
  status: r.status, revision: r.revision, createdAt: r.created_at, resolution: r.resolution,
  handledBy: r.handled_by, handledAt: r.handled_at, courseId: r.course_id });
export const moderationRoutes = new Hono<AppEnv>();
moderationRoutes.post('/contents/:id/reports', async c => {
  const a = actor(c), target = await visibleContent(c, c.req.param('id'));
  const data = await input(c, z.object({ reason: z.string().trim().min(3).max(1000) }).strict());
  const identity = await requestIdentity(c, data), id = uid();
  const previous = await db(c).get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM reports
    WHERE reporter_id=${a.id} AND request_key=${identity.key}`);
  if (previous) {
    if (previous.request_hash !== identity.fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    c.header('Idempotency-Replayed', 'true'); return c.json({ id: previous.id }, 201);
  }
  const pending = await db(c).get(sql`SELECT 1 FROM reports WHERE content_id=${target.id} AND reporter_id=${a.id} AND status='pending'`);
  if (pending) throw new ApiError(409, 'REPORT_ALREADY_PENDING', '该内容已有你的待处理举报');
  await db(c).run(sql`INSERT INTO reports(id,content_id,reporter_id,reason,created_at,request_key,request_hash)
    SELECT ${id},id,${a.id},${data.reason},${now()},${identity.key},${identity.fingerprint} FROM public_contents
    WHERE id=${target.id} AND ${activeUser(a)} ON CONFLICT DO NOTHING`);
  const made = await db(c).get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM reports WHERE reporter_id=${a.id} AND request_key=${identity.key}`);
  if (!made) throw new ApiError(409, 'REPORT_CONFLICT', '举报已存在或目标状态已变化');
  if (made.request_hash !== identity.fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
  return c.json({ id: made.id }, 201);
});
moderationRoutes.get('/moderation/reports', async c => {
  const a = actor(c), p = page(c), courseId = c.req.query('courseId');
  if (!['teacher', 'admin'].includes(a.role)) throw new ApiError(403, 'REVIEWER_REQUIRED', '需要课程教师或管理员权限');
  if (courseId) await requireManagement(c, courseId);
  const status = parsedEnum(c.req.query('status'), ['pending', 'resolved', 'dismissed', 'all'] as const, 'pending');
  const rows = await db(c).all<Report>(sql`SELECT r.*,t.course_id FROM reports r JOIN contents t ON t.id=r.content_id
    WHERE ${management(a, sql`t.course_id`)} ${courseId ? sql`AND t.course_id=${courseId}` : sql``}
    ${status === 'all' ? sql`` : sql`AND r.status=${status}`} ORDER BY r.created_at ASC,r.id ASC
    LIMIT ${p.pageSize + 1} OFFSET ${p.offset}`);
  return c.json(listResult(rows.map(reportDto), p));
});
moderationRoutes.patch('/moderation/reports/:id', async c => {
  const a = actor(c), id = c.req.param('id');
  const report = await db(c).get<Report>(sql`SELECT r.*,t.course_id FROM reports r JOIN contents t ON t.id=r.content_id WHERE r.id=${id}`);
  if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', '举报不存在');
  await requireManagement(c, report.course_id);
  const data = await input(c, z.object({ revision: revisionSchema, status: z.enum(['resolved', 'dismissed']),
    resolution: z.string().trim().min(3).max(1000) }).strict());
  const result = await db(c).run(sql`UPDATE reports SET status=${data.status},resolution=${data.resolution},handled_by=${a.id},
    handled_at=${now()},revision=revision+1 WHERE id=${id} AND revision=${data.revision} AND status='pending'
    AND EXISTS(SELECT 1 FROM contents t WHERE t.id=reports.content_id AND ${management(a, sql`t.course_id`)})`);
  assertChanged(result); return c.json({ id, status: data.status, revision: data.revision + 1 });
});
moderationRoutes.get('/moderation/contents/:id', async c => {
  const row = await rawContent(c, c.req.param('id'));
  await requireManagement(c, row.course_id);
  return c.json({ id: row.id, kind: row.kind, courseId: row.course_id, authorId: row.author_id,
    title: row.title, body: row.body, status: row.status, revision: row.revision,
    questionId: row.question_id, targetKind: row.target_kind, targetId: row.target_id, replyToId: row.reply_to_id,
    createdAt: row.created_at, updatedAt: row.updated_at });
});
moderationRoutes.put('/contents/:id/moderation', async c => {
  const row = await rawContent(c, c.req.param('id')), a = await requireManagement(c, row.course_id);
  const data = await input(c, z.object({ revision: revisionSchema, action: z.enum(['hide', 'restore']),
    reason: z.string().trim().min(3).max(1000) }).strict());
  if (row.status === 'deleted') throw new ApiError(409, 'DELETED_CONTENT', '作者已删除的内容不能恢复或下架');
  const desired = data.action === 'hide' ? 'hidden' : 'visible';
  if (row.status === desired) return c.json({ id: row.id, status: desired, revision: row.revision, changed: false });
  const result = await db(c).run(sql`UPDATE contents SET status=${desired},revision=revision+1,updated_at=${now()},updated_by=${a.id},
    change_reason=${data.reason},accepted_answer_id=NULL,accepted_by=NULL,accepted_at=NULL,accepted_semester_id=NULL,
    acceptance_id=NULL,award_cents=0,award_eligible=0 WHERE id=${row.id} AND revision=${data.revision} AND status=${row.status}
    AND ${management(a, sql`contents.course_id`)}`);
  assertChanged(result); return c.json({ id: row.id, status: desired, revision: data.revision + 1, changed: true });
});
moderationRoutes.get('/moderation/actions', async c => {
  const a = actor(c), p = page(c), courseId = c.req.query('courseId');
  if (!['teacher', 'admin'].includes(a.role)) throw new ApiError(403, 'REVIEWER_REQUIRED', '需要课程教师或管理员权限');
  if (courseId) await requireManagement(c, courseId);
  const rows = await db(c).all<{ id: number; contentId: string; actorId: string; oldStatus: string; newStatus: string; reason: string; createdAt: string }>(sql`
    SELECT m.id,m.content_id AS contentId,m.actor_id AS actorId,m.old_status AS oldStatus,m.new_status AS newStatus,m.reason,m.created_at AS createdAt
    FROM moderation_actions m JOIN contents t ON t.id=m.content_id WHERE ${management(a, sql`t.course_id`)}
    ${courseId ? sql`AND t.course_id=${courseId}` : sql``} ORDER BY m.id DESC LIMIT ${p.pageSize + 1} OFFSET ${p.offset}`);
  return c.json(listResult(rows, p));
});