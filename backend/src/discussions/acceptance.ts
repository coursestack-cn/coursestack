import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, assertChanged, input, listResult, page, pointsSchema, revisionSchema, idSchema, queryPage } from '../http.ts';
import { management, requireManagement } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv, Ctx } from '../discussions/types.ts';
import { publicDetail, rawContent, visibleContent } from '../discussions/service.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();

export const acceptanceRoutes = new Hono<AppEnv>();
acceptanceRoutes.put('/questions/:id/acceptance', async c => {
    const q = await visibleContent(c, c.req.param('id'), 'question'), a = await requireManagement(c, q.course_id);
    const data = await input(c, z.object({ revision: revisionSchema, answerId: idSchema.nullable() }).strict());
    if (q.accepted_answer_id === data.answerId) return respond(c, { ...await publicDetail(c, q.id), changed: false });
    const at = now();
    if (data.answerId === null) {
        const result = await createDatabase(c.env.DB).run(sql`UPDATE contents SET accepted_answer_id=NULL,accepted_by=NULL,accepted_at=NULL,
            accepted_term_id=NULL,acceptance_id=NULL,award_cents=0,award_eligible=0,updated_by=${a.id},updated_at=${at},
            revision=revision+1 WHERE id=${q.id} AND status='visible'
            AND revision=${data.revision} AND ${management(a, sql`contents.course_id`)}`);
        assertChanged(result);
    } else {
        const answer = await visibleContent(c, data.answerId, 'answer');
        if (answer.target_kind !== 'question' || answer.target_id !== q.id) throw new HttpError(400, 'ANSWER_QUESTION_MISMATCH', '答案不属于此问题');
        const semester = await createDatabase(c.env.DB).get<{ id: string }>(sql`SELECT id FROM terms WHERE current=1`);
        if (!semester) throw new HttpError(409, 'NO_CURRENT_TERM', '采纳需指定当前学期');
        const eligible = sql`EXISTS(SELECT 1 FROM accounts student JOIN enrollments en ON en.account_id=student.id
            JOIN terms sem ON sem.current=1 AND sem.id=en.term_id
            WHERE student.id=${answer.author_id} AND student.role='student' AND student.status='active'
                AND en.course_id=contents.course_id AND en.term_id=${semester.id})`;
        const result = await createDatabase(c.env.DB).run(sql`UPDATE contents SET accepted_answer_id=${answer.id},accepted_by=${a.id},accepted_at=${at},
            accepted_term_id=${semester.id},acceptance_id=${uid()},award_eligible=${eligible},
            award_cents=CASE WHEN ${eligible} THEN (SELECT CASE WHEN bonus_enabled=1 THEN bonus_cents ELSE 0 END FROM courses WHERE id=contents.course_id) ELSE 0 END,
            updated_by=${a.id},updated_at=${at},revision=revision+1
            WHERE id=${q.id} AND status='visible' AND revision=${data.revision} AND ${management(a, sql`contents.course_id`)}
            AND EXISTS(SELECT 1 FROM terms WHERE current=1 AND id=${semester.id})
            AND EXISTS(SELECT 1 FROM public_contents ans WHERE ans.id=${answer.id} AND ans.target_kind='question' AND ans.target_id=contents.id)`);
        assertChanged(result);
    }
    const changed = await rawContent(c, q.id);
    return respond(c, { ...await publicDetail(c, q.id), changed: true,
        award: { points: changed.award_cents / 100, termId: changed.accepted_term_id } });
});
acceptanceRoutes.patch('/questions/:id/award', async c => {
    const q = await visibleContent(c, c.req.param('id'), 'question'), a = await requireManagement(c, q.course_id);
    const data = await input(c, z.object({ revision: revisionSchema, bonusPoints: pointsSchema, reason: z.string().trim().min(3).max(500) }).strict());
    if (!q.accepted_answer_id || !q.award_eligible) throw new HttpError(409, 'AWARD_NOT_ELIGIBLE', '此采纳没有符合加分条件的正式修读学生');
    const cents = Math.round(data.bonusPoints * 100);
    if (cents === q.award_cents) return respond(c, { id: q.id, changed: false, revision: q.revision, bonusPoints: cents / 100 });
    const acceptanceId = uid(), at = now(), reason = 'award.adjusted: ' + data.reason;
    const gate = sql`contents.id=${q.id} AND contents.status='visible' AND contents.revision=${data.revision}
        AND contents.accepted_answer_id IS NOT NULL AND contents.award_eligible=1 AND ${management(a, sql`contents.course_id`)}`;
    // Save the explanation with the two ledger entries in the same transaction.
    // The automatic trigger skips these already-written acceptance/operation pairs.
    const result = await c.env.DB.batch([
        sql`INSERT INTO bonus_ledger(acceptance_id,operation,course_id,question_id,answer_id,student_id,term_id,teacher_id,operator_id,delta_cents,reason,created_at)
            SELECT contents.acceptance_id,'revoke',contents.course_id,contents.id,answer.id,answer.author_id,
                contents.accepted_term_id,contents.accepted_by,${a.id},-contents.award_cents,${reason},${at}
            FROM contents JOIN contents answer ON answer.id=contents.accepted_answer_id WHERE ${gate} AND contents.award_cents>0`,
        sql`INSERT INTO bonus_ledger(acceptance_id,operation,course_id,question_id,answer_id,student_id,term_id,teacher_id,operator_id,delta_cents,reason,created_at)
            SELECT ${acceptanceId},'award',contents.course_id,contents.id,answer.id,answer.author_id,
                contents.accepted_term_id,${a.id},${a.id},${cents},${reason},${at}
            FROM contents JOIN contents answer ON answer.id=contents.accepted_answer_id WHERE ${gate} AND ${cents}>0`,
        sql`UPDATE contents SET award_cents=${cents},acceptance_id=${acceptanceId},accepted_by=${a.id},
            revision=revision+1,updated_by=${a.id},updated_at=${at} WHERE ${gate}`,
    ].map(s => prepareStatement(c.env.DB, s)));
    assertChanged(result[2]);
    return respond(c, { id: q.id, changed: true, revision: data.revision + 1, bonusPoints: cents / 100 });
});
type Ledger = { id: number; acceptance_id: string; operation: string; course_id: string; question_id: string;
    answer_id: string; student_id: string; term_id: string; teacher_id: string; operator_id: string;
    delta_cents: number; reason: string; created_at: number };
function ledgerDto(r: Ledger) {
    return { id: r.id, acceptanceId: r.acceptance_id, operation: r.operation, courseId: r.course_id, questionId: r.question_id,
        answerId: r.answer_id, studentId: r.student_id, termId: r.term_id, teacherId: r.teacher_id,
        operatorId: r.operator_id, deltaCents: r.delta_cents, deltaPoints: r.delta_cents / 100, reason: r.reason, createdAt: r.created_at };
}
function termFilter(c: Ctx) {
    const term = c.req.query('termId');
    if (term && !idSchema.safeParse(term).success) throw new HttpError(400, 'INVALID_FILTER', '学期ID无效');
    return term ? sql`AND l.term_id=${term}` : sql``;
}
acceptanceRoutes.get('/courses/:id/bonus-ledger', async c => {
    const courseId = c.req.param('id'), a = await requireManagement(c, courseId), p = page(c);
    const { rows, total } = await queryPage<Ledger>(c, p, sql`SELECT l.* FROM bonus_ledger l WHERE l.course_id=${courseId}
        ${termFilter(c)} AND ${management(a, sql`l.course_id`)} ORDER BY l.id DESC`);
    return respond(c, listResult(rows.map(ledgerDto), p, total));
});
acceptanceRoutes.get('/courses/:id/bonus-summary', async c => {
    const courseId = c.req.param('id'), a = await requireManagement(c, courseId), p = page(c);
    const { rows, total } = await queryPage<{ studentId: string; nickname: string; termId: string; totalCents: number }>(c, p, sql`
        SELECT l.student_id AS studentId,u.nickname AS nickname,l.term_id AS termId,SUM(l.delta_cents) AS totalCents
        FROM bonus_ledger l JOIN accounts u ON u.id=l.student_id WHERE l.course_id=${courseId} ${termFilter(c)}
        AND ${management(a, sql`l.course_id`)} GROUP BY l.student_id,l.term_id ORDER BY l.student_id,l.term_id`);
    return respond(c, listResult(rows.map(r => ({ ...r, totalPoints: r.totalCents / 100 })), p, total));
});
acceptanceRoutes.get('/me/bonus-ledger', async c => {
    const a = actor(c), p = page(c), courseId = c.req.query('courseId');
    const { rows, total } = await queryPage<Ledger>(c, p, sql`SELECT l.* FROM bonus_ledger l WHERE l.student_id=${a.id} ${termFilter(c)}
        ${courseId ? sql`AND l.course_id=${courseId}` : sql``} ORDER BY l.id DESC`);
    return respond(c, listResult(rows.map(ledgerDto), p, total));
});