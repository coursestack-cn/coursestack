import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, input, listResult, page, idSchema, queryPage, requestIdentity } from '../http.ts';
import { management, requireManagement } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv, Ctx } from './types.ts';
import { createDatabase } from '../db/index.ts';

type Ledger = { id: number; operation: string; course_id: string; student_id: string; term_id: string;
    delta_points: number; source_kind: string; source_id: string; operator_id: string; reason: string;
    reverses_id: number | null; request_hash: string | null; created_at: number };
const ledgerDto = (r: Ledger) => ({ id: r.id, operation: r.operation, courseId: r.course_id, termId: r.term_id,
    studentId: r.student_id, deltaPoints: r.delta_points, sourceKind: r.source_kind, sourceId: r.source_id,
    operatorId: r.operator_id, reason: r.reason, reversesId: r.reverses_id, createdAt: r.created_at });
function termFilter(c: Ctx) {
    const term = c.req.query('termId');
    if (term && !idSchema.safeParse(term).success) throw new HttpError(400, 'INVALID_FILTER', '学期ID无效');
    return term ? sql`AND l.term_id=${term}` : sql``;
}
export const bonusRoutes = new Hono<AppEnv>();
bonusRoutes.post('/courses/:id/bonus-adjustments', async c => {
    const courseId = c.req.param('id'), a = await requireManagement(c, courseId);
    const data = await input(c, z.object({ studentId: idSchema, termId: idSchema,
        deltaPoints: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).refine(value => value !== 0, '积分调整不能为零'),
        reason: z.string().trim().min(1).max(500) }).strict());
    const identity = await requestIdentity(c, data);
    const previous = () => createDatabase(c.env.DB).get<Ledger>(sql`SELECT * FROM bonus_ledger
        WHERE operation='manual' AND operator_id=${a.id} AND source_id=${identity.key}`);
    let row = await previous();
    const replayed = !!row;
    if (!row) {
        await createDatabase(c.env.DB).run(sql`INSERT INTO bonus_ledger(operation,course_id,term_id,student_id,delta_points,
                source_kind,source_id,operator_id,reason,request_hash)
            SELECT 'manual',${courseId},${data.termId},student.id,${data.deltaPoints},'manual',${identity.key},${a.id},${data.reason},${identity.fingerprint}
            FROM accounts student JOIN enrollments e ON e.account_id=student.id AND e.course_id=${courseId} AND e.term_id=${data.termId}
            WHERE student.id=${data.studentId} AND student.role='student' AND student.status<>'deleted'
                AND ${management(a, sql`e.course_id`)} ON CONFLICT DO NOTHING`);
        row = await previous();
    }
    if (!row) throw new HttpError(409, 'BONUS_TARGET_UNAVAILABLE', '学生不在指定课程学期名单中，或账号及操作权限已变化');
    if (row.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    if (replayed) c.header('Idempotency-Replayed', 'true');
    return respond(c, ledgerDto(row), 201);
});
bonusRoutes.get('/courses/:id/bonus-ledger', async c => {
    const courseId = c.req.param('id'), a = await requireManagement(c, courseId), p = page(c);
    const { rows, total } = await queryPage<Ledger>(c, p, sql`SELECT l.* FROM bonus_ledger l WHERE l.course_id=${courseId}
        ${termFilter(c)} AND ${management(a, sql`l.course_id`)} ORDER BY l.id DESC`);
    return respond(c, listResult(rows.map(ledgerDto), p, total));
});
bonusRoutes.get('/courses/:id/bonus-summary', async c => {
    const courseId = c.req.param('id'), a = await requireManagement(c, courseId), p = page(c);
    const { rows, total } = await queryPage<{ studentId: string; nickname: string | null; termId: string; totalPoints: number }>(c, p, sql`
        SELECT l.student_id AS studentId,CASE WHEN u.status='deleted' THEN '已删除' ELSE u.nickname END AS nickname,
            l.term_id AS termId,SUM(l.delta_points) AS totalPoints
        FROM bonus_ledger l JOIN accounts u ON u.id=l.student_id WHERE l.course_id=${courseId} ${termFilter(c)}
        AND ${management(a, sql`l.course_id`)} GROUP BY l.student_id,l.term_id ORDER BY l.student_id,l.term_id`);
    return respond(c, listResult(rows, p, total));
});
bonusRoutes.get('/me/bonus-ledger', async c => {
    const a = actor(c), p = page(c), courseId = c.req.query('courseId');
    const { rows, total } = await queryPage<Ledger>(c, p, sql`SELECT l.* FROM bonus_ledger l WHERE l.student_id=${a.id} ${termFilter(c)}
        ${courseId ? sql`AND l.course_id=${courseId}` : sql``} ORDER BY l.id DESC`);
    return respond(c, listResult(rows.map(ledgerDto), p, total));
});