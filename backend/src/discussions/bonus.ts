import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, input, listResult, page, idSchema, queryPage, requestIdentity } from '../http.ts';
import { classManagement } from '../permissions.ts';
import { classPath, requireClass } from '../courses/classes.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv, Ctx } from './types.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
import { courseIdSchema } from '../courses/validation.ts';

type Ledger = { id: number; course_id: string; student_id: string; term_id: string; teacher_id: string;
    delta_points: number; source_kind: string; source_id: string; operator_id: string; reason: string | null;
    reverses_id: number | null; request_hash: string | null; created_at: number; student_name: string | null;
    course_name: string; term_name: string };
const ledgerDto = (r: Ledger) => ({ id: r.id, courseId: r.course_id, termId: r.term_id, teacherId: r.teacher_id,
    studentId: r.student_id, studentNickname: r.student_name, deltaPoints: r.delta_points, sourceKind: r.source_kind, sourceId: r.source_id,
    operatorId: r.operator_id, reason: r.reason, reversesId: r.reverses_id, createdAt: r.created_at });
const personalLedgerDto = (r: Ledger) => ({ ...ledgerDto(r), courseName: r.course_name, termName: r.term_name });
const ledgerSelect = sql`SELECT l.*,CASE WHEN student.status='deleted' THEN '已删除' ELSE student.nickname END AS student_name,
    course.name AS course_name,term.name AS term_name FROM bonus_ledger l JOIN accounts student ON student.id=l.student_id
    JOIN courses course ON course.id=l.course_id JOIN terms term ON term.id=l.term_id`;
function termFilter(c: Ctx) {
    const term = c.req.query('termId');
    if (term && !idSchema.safeParse(term).success) throw new HttpError(400, 'INVALID_FILTER', '学期ID无效');
    return term ? sql`AND l.term_id=${term}` : sql``;
}
export const bonusRoutes = new Hono<AppEnv>();
bonusRoutes.post(`${classPath}/bonus-adjustments`, async c => {
    const { a, courseId, termId, teacherId } = await requireClass(c);
    const data = await input(c, z.object({ studentId: idSchema,
        deltaPoints: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).refine(value => value !== 0, '积分调整不能为零'),
        reason: z.string().trim().min(1).max(500).nullable().default(null) }).strict());
    const identity = await requestIdentity(c, data);
    const previous = () => createDatabase(c.env.DB).get<Ledger>(sql`${ledgerSelect}
        WHERE source_kind='manual' AND operator_id=${a.id} AND source_id=${identity.key}`);
    let row = await previous();
    const replayed = !!row;
    if (!row) {
        await createDatabase(c.env.DB).run(sql`INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,
                source_kind,source_id,operator_id,reason,request_hash)
            SELECT ${courseId},${termId},e.teacher_id,student.id,${data.deltaPoints},'manual',${identity.key},${a.id},${data.reason},${identity.fingerprint}
            FROM accounts student JOIN class_students e ON e.student_id=student.id AND e.course_id=${courseId} AND e.term_id=${termId}
            WHERE e.teacher_id=${teacherId} AND student.id=${data.studentId} AND student.role='student' AND student.status<>'deleted'
                AND ${classManagement(a, sql`e.course_id`, sql`e.term_id`, sql`e.teacher_id`)} ON CONFLICT DO NOTHING`);
        row = await previous();
    }
    if (!row) throw new HttpError(409, 'BONUS_TARGET_UNAVAILABLE', '学生不在指定课程学期名单中，或账号及操作权限已变化');
    if (row.course_id !== courseId || row.term_id !== termId || row.teacher_id !== teacherId || row.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    if (!await createDatabase(c.env.DB).get(sql`SELECT 1 WHERE ${classManagement(a, sql`${row.course_id}`, sql`${row.term_id}`, sql`${row.teacher_id}`)}`)) {
        throw new HttpError(403, 'CLASS_PERMISSION_DENIED', '需要本人本学期教学班或管理员权限');
    }
    if (replayed) c.header('Idempotency-Replayed', 'true');
    return respond(c, ledgerDto(row), 201);
});
bonusRoutes.get(`${classPath}/bonus-ledger`, async c => {
    const { a, courseId, termId, teacherId } = await requireClass(c), p = page(c);
    const { rows, total } = await queryPage<Ledger>(c, p, sql`${ledgerSelect} WHERE l.course_id=${courseId}
        AND l.term_id=${termId} AND l.teacher_id=${teacherId} AND ${classManagement(a, sql`l.course_id`, sql`l.term_id`, sql`l.teacher_id`)} ORDER BY l.id DESC`);
    return respond(c, listResult(rows.map(ledgerDto), p, total));
});
bonusRoutes.get(`${classPath}/bonus-summary`, async c => {
    const { a, courseId, termId, teacherId } = await requireClass(c), p = page(c);
    const { rows, total } = await queryPage<{ studentId: string; nickname: string | null; termId: string; teacherId: string; totalPoints: number }>(c, p, sql`
        SELECT l.student_id AS studentId,CASE WHEN u.status='deleted' THEN '已删除' ELSE u.nickname END AS nickname,
            l.term_id AS termId,l.teacher_id AS teacherId,SUM(l.delta_points) AS totalPoints
        FROM bonus_ledger l JOIN accounts u ON u.id=l.student_id WHERE l.course_id=${courseId} AND l.term_id=${termId} AND l.teacher_id=${teacherId}
        AND ${classManagement(a, sql`l.course_id`, sql`l.term_id`, sql`l.teacher_id`)} GROUP BY l.student_id,l.term_id,l.teacher_id ORDER BY l.student_id,l.term_id`);
    return respond(c, listResult(rows, p, total));
});
bonusRoutes.get('/me/bonus-ledger', async c => {
    const a = actor(c), p = page(c), courseId = c.req.query('courseId');
    if (courseId !== undefined && !courseIdSchema.safeParse(courseId).success) throw new HttpError(400, 'INVALID_FILTER', '课程号无效');
    const filter = sql`l.student_id=${a.id} ${termFilter(c)} ${courseId ? sql`AND l.course_id=${courseId}` : sql``}`;
    const [entries, summary] = await c.env.DB.batch([
        sql`${ledgerSelect} WHERE ${filter} ORDER BY l.id DESC LIMIT ${p.pageSize} OFFSET ${p.offset}`,
        sql`SELECT COUNT(*) AS total,COALESCE(SUM(l.delta_points),0) AS totalPoints FROM bonus_ledger l WHERE ${filter}`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    const rows = entries.results as Ledger[], totals = summary.results[0] as { total: number; totalPoints: number };
    return respond(c, { ...listResult(rows.map(personalLedgerDto), p, totals.total), totalPoints: totals.totalPoints });
});
bonusRoutes.get('/me/bonus-policy', async c => {
    const a = actor(c), courseId = c.req.query('courseId'), db = createDatabase(c.env.DB);
    if (a.role !== 'student') throw new HttpError(403, 'STUDENT_REQUIRED', '仅学生可读取本人加分规则');
    if (!courseIdSchema.safeParse(courseId).success) throw new HttpError(400, 'INVALID_FILTER', '课程号无效');
    if (!await db.get(sql`SELECT 1 FROM courses WHERE id=${courseId}`)) throw new HttpError(404, 'COURSE_NOT_FOUND', '课程不存在');
    const term = await db.get<{ id: string; name: string }>(sql`SELECT id,name FROM terms WHERE current=1`);
    type PolicyRow = { teacherId: string; nickname: string | null; isDeleted: number; pointsQuestion: number; pointsAnswer: number;
        pointsAcceptance: number; pointsComment: number; pointsMaterial: number; pointsMaterialVersion: number };
    const row = term ? await db.get<PolicyRow>(sql`SELECT s.teacher_id AS teacherId,
        CASE WHEN t.status='deleted' THEN '已删除' ELSE t.nickname END AS nickname,t.status='deleted' AS isDeleted,
        r.points_question AS pointsQuestion,r.points_answer AS pointsAnswer,r.points_acceptance AS pointsAcceptance,
        r.points_comment AS pointsComment,r.points_material AS pointsMaterial,r.points_material_version AS pointsMaterialVersion
        FROM class_students s JOIN class_bonus_rules r ON r.course_id=s.course_id AND r.term_id=s.term_id AND r.teacher_id=s.teacher_id
        JOIN accounts t ON t.id=s.teacher_id WHERE s.student_id=${a.id} AND s.course_id=${courseId} AND s.term_id=${term.id}`) : undefined;
    return respond(c, { courseId, currentTerm: term ?? null, membership: row ? {
        teacher: { id: row.teacherId, nickname: row.nickname, isDeleted: Boolean(row.isDeleted) },
        bonusPolicy: { pointsQuestion: row.pointsQuestion, pointsAnswer: row.pointsAnswer, pointsAcceptance: row.pointsAcceptance,
            pointsComment: row.pointsComment, pointsMaterial: row.pointsMaterial, pointsMaterialVersion: row.pointsMaterialVersion }
    } : null });
});
bonusRoutes.get('/me/bonus-events', async c => {
    const a = actor(c), db = createDatabase(c.env.DB);
    const parsed = z.object({ afterId: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).optional(),
        pageSize: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(c.req.query());
    if (!parsed.success) throw new HttpError(400, 'INVALID_FILTER', '积分通知游标或分页大小无效');
    const { afterId, pageSize } = parsed.data;
    // A new browser starts at the current ledger position instead of replaying all past awards.
    if (afterId === undefined) {
        const latest = await db.get<{ id: number }>(sql`SELECT COALESCE(MAX(id),0) AS id FROM bonus_ledger WHERE student_id=${a.id}`);
        return respond(c, { items: [], nextCursor: latest?.id ?? 0, hasMore: false });
    }
    const rows = await db.all<Ledger>(sql`${ledgerSelect} WHERE l.student_id=${a.id} AND l.id>${afterId} ORDER BY l.id LIMIT ${pageSize + 1}`);
    const items = rows.slice(0, pageSize);
    return respond(c, { items: items.map(personalLedgerDto), nextCursor: items.at(-1)?.id ?? afterId, hasMore: rows.length > pageSize });
});