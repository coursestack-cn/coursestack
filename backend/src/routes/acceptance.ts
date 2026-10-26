import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError, actor, assertChanged, db, idSchema, input, listResult, management, now, page,
  pointsSchema, publicDetail, rawContent, requireManagement, revisionSchema, uid, visibleContent,
  type AppEnv, type Ctx } from '../core';

export const acceptanceRoutes = new Hono<AppEnv>();
acceptanceRoutes.put('/questions/:id/acceptance', async c => {
  const q = await visibleContent(c, c.req.param('id'), 'question'), a = await requireManagement(c, q.course_id);
  const data = await input(c, z.object({ revision: revisionSchema, answerId: idSchema.nullable() }).strict());
  if (q.accepted_answer_id === data.answerId) return c.json({ ...await publicDetail(c, q.id), changed: false });
  const at = now();
  if (data.answerId === null) {
    const result = await db(c).run(sql`UPDATE contents SET accepted_answer_id=NULL,accepted_by=NULL,accepted_at=NULL,
      accepted_semester_id=NULL,acceptance_id=NULL,award_cents=0,award_eligible=0,updated_by=${a.id},updated_at=${at},
      change_reason='acceptance.cancelled',revision=revision+1 WHERE id=${q.id} AND status='visible'
      AND revision=${data.revision} AND ${management(a, sql`contents.course_id`)}`);
    assertChanged(result);
  } else {
    const answer = await visibleContent(c, data.answerId, 'answer');
    if (answer.question_id !== q.id) throw new ApiError(400, 'ANSWER_QUESTION_MISMATCH', '答案不属于此问题');
    const semester = await db(c).get<{ id: string }>(sql`SELECT id FROM semesters WHERE status='active'`);
    if (!semester) throw new ApiError(409, 'NO_ACTIVE_SEMESTER', '采纳需指定当前学期');
    const eligible = sql`EXISTS(SELECT 1 FROM users student JOIN enrollments en ON en.user_id=student.id
      JOIN semesters sem ON sem.id=en.semester_id AND sem.status='active'
      WHERE student.id=${answer.author_id} AND student.role='student' AND student.active=1
        AND en.course_id=contents.course_id AND en.semester_id=${semester.id})`;
    const result = await db(c).run(sql`UPDATE contents SET accepted_answer_id=${answer.id},accepted_by=${a.id},accepted_at=${at},
      accepted_semester_id=${semester.id},acceptance_id=${uid()},award_eligible=${eligible},
      award_cents=CASE WHEN ${eligible} THEN (SELECT CASE WHEN bonus_enabled=1 THEN bonus_cents ELSE 0 END FROM courses WHERE id=contents.course_id) ELSE 0 END,
      updated_by=${a.id},updated_at=${at},change_reason='acceptance.changed',revision=revision+1
      WHERE id=${q.id} AND status='visible' AND revision=${data.revision} AND ${management(a, sql`contents.course_id`)}
      AND EXISTS(SELECT 1 FROM semesters WHERE id=${semester.id} AND status='active')
      AND EXISTS(SELECT 1 FROM public_contents ans WHERE ans.id=${answer.id} AND ans.question_id=contents.id)`);
    assertChanged(result);
  }
  const changed = await rawContent(c, q.id);
  return c.json({ ...await publicDetail(c, q.id), changed: true,
    award: { points: changed.award_cents / 100, semesterId: changed.accepted_semester_id } });
});
acceptanceRoutes.patch('/questions/:id/award', async c => {
  const q = await visibleContent(c, c.req.param('id'), 'question'), a = await requireManagement(c, q.course_id);
  const data = await input(c, z.object({ revision: revisionSchema, bonusPoints: pointsSchema, reason: z.string().trim().min(3).max(500) }).strict());
  if (!q.accepted_answer_id || !q.award_eligible) throw new ApiError(409, 'AWARD_NOT_ELIGIBLE', '此采纳没有符合加分条件的正式修读学生');
  const cents = Math.round(data.bonusPoints * 100);
  if (cents === q.award_cents) return c.json({ id: q.id, changed: false, revision: q.revision, bonusPoints: cents / 100 });
  const result = await db(c).run(sql`UPDATE contents SET award_cents=${cents},acceptance_id=${uid()},accepted_by=${a.id},
    revision=revision+1,updated_by=${a.id},updated_at=${now()},change_reason=${'award.adjusted: ' + data.reason}
    WHERE id=${q.id} AND status='visible' AND revision=${data.revision} AND accepted_answer_id IS NOT NULL
    AND award_eligible=1 AND ${management(a, sql`contents.course_id`)}`);
  assertChanged(result);
  return c.json({ id: q.id, changed: true, revision: data.revision + 1, bonusPoints: cents / 100 });
});
type Ledger = { id: number; acceptance_id: string; operation: string; course_id: string; question_id: string;
  answer_id: string; student_id: string; semester_id: string; teacher_id: string; operator_id: string;
  delta_cents: number; reason: string; created_at: string };
function ledgerDto(r: Ledger) {
  return { id: r.id, acceptanceId: r.acceptance_id, operation: r.operation, courseId: r.course_id, questionId: r.question_id,
    answerId: r.answer_id, studentId: r.student_id, semesterId: r.semester_id, teacherId: r.teacher_id,
    operatorId: r.operator_id, deltaCents: r.delta_cents, deltaPoints: r.delta_cents / 100, reason: r.reason, createdAt: r.created_at };
}
function termFilter(c: Ctx) {
  const term = c.req.query('semesterId');
  if (term && !idSchema.safeParse(term).success) throw new ApiError(400, 'INVALID_FILTER', '学期ID无效');
  return term ? sql`AND l.semester_id=${term}` : sql``;
}
acceptanceRoutes.get('/courses/:id/bonus-ledger', async c => {
  const courseId = c.req.param('id'), a = await requireManagement(c, courseId), p = page(c);
  const rows = await db(c).all<Ledger>(sql`SELECT l.* FROM bonus_ledger l WHERE l.course_id=${courseId}
    ${termFilter(c)} AND ${management(a, sql`l.course_id`)} ORDER BY l.id DESC LIMIT ${p.pageSize + 1} OFFSET ${p.offset}`);
  return c.json(listResult(rows.map(ledgerDto), p));
});
acceptanceRoutes.get('/courses/:id/bonus-summary', async c => {
  const courseId = c.req.param('id'), a = await requireManagement(c, courseId), p = page(c);
  const rows = await db(c).all<{ studentId: string; displayName: string; semesterId: string; totalCents: number }>(sql`
    SELECT l.student_id AS studentId,u.display_name AS displayName,l.semester_id AS semesterId,SUM(l.delta_cents) AS totalCents
    FROM bonus_ledger l JOIN users u ON u.id=l.student_id WHERE l.course_id=${courseId} ${termFilter(c)}
    AND ${management(a, sql`l.course_id`)} GROUP BY l.student_id,l.semester_id ORDER BY l.student_id,l.semester_id
    LIMIT ${p.pageSize + 1} OFFSET ${p.offset}`);
  return c.json(listResult(rows.map(r => ({ ...r, totalPoints: r.totalCents / 100 })), p));
});
acceptanceRoutes.get('/me/bonus-ledger', async c => {
  const a = actor(c), p = page(c), courseId = c.req.query('courseId');
  const rows = await db(c).all<Ledger>(sql`SELECT l.* FROM bonus_ledger l WHERE l.student_id=${a.id} ${termFilter(c)}
    ${courseId ? sql`AND l.course_id=${courseId}` : sql``} ORDER BY l.id DESC LIMIT ${p.pageSize + 1} OFFSET ${p.offset}`);
  return c.json(listResult(rows.map(ledgerDto), p));
});