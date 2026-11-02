import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { actor } from '../auth/middleware.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
import { type AppEnv, type Ctx } from '../discussions/types.ts';
import { HttpError, assertChanged, idSchema, input, listResult, page, pointsSchema, queryPage, respond } from '../http.ts';
import { activeUser, administration, classManagement, requireAdministrator } from '../permissions.ts';

export const classPath = '/courses/:id/terms/:termId/teachers/:teacherId';
export function classKey(c: Ctx) {
    return { courseId: c.req.param('id')!, termId: c.req.param('termId')!, teacherId: c.req.param('teacherId')! };
}
export async function requireClass(c: Ctx) {
    const a = actor(c), key = classKey(c), db = createDatabase(c.env.DB);
    if (!await db.get(sql`SELECT 1 WHERE ${classManagement(a, sql`${key.courseId}`, sql`${key.termId}`, sql`${key.teacherId}`)}`)) {
        throw new HttpError(403, 'CLASS_PERMISSION_DENIED', '需要本人本学期教学班或管理员权限');
    }
    if (!await db.get(sql`SELECT 1 FROM teaching_classes WHERE course_id=${key.courseId} AND term_id=${key.termId} AND teacher_id=${key.teacherId}`)) {
        throw new HttpError(404, 'CLASS_NOT_FOUND', '教学班不存在');
    }
    return { a, ...key };
}
type ClassRow = { course_id: string; term_id: string; teacher_id: string; course_name: string; term_name: string; current: number;
    teacher_name: string | null; teacher_deleted: number; student_count: number;
    points_question: number; points_answer: number; points_acceptance: number; points_comment: number; points_material: number; points_material_version: number };
const classSelect = sql`SELECT tc.*,c.name AS course_name,t.name AS term_name,t.current,
    CASE WHEN a.status='deleted' THEN '已删除' ELSE a.nickname END AS teacher_name,a.status='deleted' AS teacher_deleted,
    (SELECT COUNT(*) FROM class_students s WHERE s.course_id=tc.course_id AND s.term_id=tc.term_id AND s.teacher_id=tc.teacher_id) AS student_count,
    r.points_question,r.points_answer,r.points_acceptance,r.points_comment,r.points_material,r.points_material_version
    FROM teaching_classes tc JOIN courses c ON c.id=tc.course_id JOIN terms t ON t.id=tc.term_id JOIN accounts a ON a.id=tc.teacher_id
    JOIN class_bonus_rules r ON r.course_id=tc.course_id AND r.term_id=tc.term_id AND r.teacher_id=tc.teacher_id`;
const classDto = (r: ClassRow) => ({ courseId: r.course_id, termId: r.term_id, teacherId: r.teacher_id,
    course: { id: r.course_id, name: r.course_name }, term: { id: r.term_id, name: r.term_name, current: Boolean(r.current) },
    teacher: { id: r.teacher_id, nickname: r.teacher_name, isDeleted: Boolean(r.teacher_deleted) }, studentCount: r.student_count,
    bonusPolicy: { pointsQuestion: r.points_question, pointsAnswer: r.points_answer, pointsAcceptance: r.points_acceptance,
        pointsComment: r.points_comment, pointsMaterial: r.points_material, pointsMaterialVersion: r.points_material_version } });
async function classDetail(c: Ctx, courseId: string, termId: string, teacherId: string) {
    const r = await createDatabase(c.env.DB).get<ClassRow>(sql`${classSelect} WHERE tc.course_id=${courseId} AND tc.term_id=${termId} AND tc.teacher_id=${teacherId}
        AND ${classManagement(actor(c), sql`tc.course_id`, sql`tc.term_id`, sql`tc.teacher_id`)}`);
    if (!r) throw new HttpError(404, 'CLASS_NOT_FOUND', '教学班不存在');
    return classDto(r);
}
export const classRoutes = new Hono<AppEnv>();
classRoutes.get('/terms', async c => {
    const rows = await createDatabase(c.env.DB).all<{ id: string; name: string; current: number }>(sql`SELECT * FROM terms ORDER BY current DESC,id DESC`);
    return respond(c, rows.map(r => ({ ...r, current: Boolean(r.current) })));
});
classRoutes.put('/terms/current', async c => {
    const a = await requireAdministrator(c), data = await input(c, z.object({ termId: idSchema.nullable() }).strict());
    const db = createDatabase(c.env.DB);
    if (data.termId !== null && !await db.get(sql`SELECT 1 FROM terms WHERE id=${data.termId}`)) throw new HttpError(404, 'TERM_NOT_FOUND', '学期不存在');
    await c.env.DB.batch([
        sql`UPDATE terms SET current=0 WHERE current=1 AND ${administration(a)}`,
        sql`UPDATE terms SET current=1 WHERE id=${data.termId} AND ${administration(a)}`,
    ].map(s => prepareStatement(c.env.DB, s)));
    await requireAdministrator(c);
    return respond(c, { termId: data.termId });
});
classRoutes.put('/terms/:termId', async c => {
    const a = await requireAdministrator(c), termId = c.req.param('termId');
    if (!idSchema.safeParse(termId).success || termId === 'current') throw new HttpError(400, 'INVALID_TERM_ID', '学期 ID 无效');
    const data = await input(c, z.object({ name: z.string().trim().min(1).max(120) }).strict());
    assertChanged(await createDatabase(c.env.DB).run(sql`INSERT INTO terms(id,name) SELECT ${termId},${data.name} WHERE ${administration(a)}
        ON CONFLICT(id) DO UPDATE SET name=excluded.name`));
    return respond(c, { id: termId, name: data.name });
});
classRoutes.get('/courses/:id/terms', async c => {
    const rows = await createDatabase(c.env.DB).all<{ id: string; name: string; current: number }>(sql`
        SELECT t.* FROM course_terms ct JOIN terms t ON t.id=ct.term_id WHERE ct.course_id=${c.req.param('id')} ORDER BY t.current DESC,t.id DESC`);
    return respond(c, rows.map(r => ({ ...r, current: Boolean(r.current) })));
});
classRoutes.put('/courses/:id/terms/:termId', async c => {
    const a = await requireAdministrator(c), courseId = c.req.param('id'), termId = c.req.param('termId');
    await createDatabase(c.env.DB).run(sql`INSERT INTO course_terms(course_id,term_id) SELECT ${courseId},${termId}
        WHERE ${administration(a)} ON CONFLICT DO NOTHING`);
    await requireAdministrator(c);
    return respond(c, { courseId, termId });
});
classRoutes.delete('/courses/:id/terms/:termId', async c => {
    const a = await requireAdministrator(c), courseId = c.req.param('id'), termId = c.req.param('termId');
    // Once a teacher joins, the offering anchors class history and cannot be cancelled here.
    await createDatabase(c.env.DB).run(sql`DELETE FROM course_terms WHERE course_id=${courseId} AND term_id=${termId} AND ${administration(a)}`);
    await requireAdministrator(c);
    return respond(c, { courseId, termId });
});
classRoutes.put('/courses/:id/terms/:termId/teachers/me', async c => {
    const a = actor(c), courseId = c.req.param('id'), termId = c.req.param('termId'), db = createDatabase(c.env.DB);
    if (a.role !== 'teacher') throw new HttpError(403, 'TEACHER_REQUIRED', '只有教师可以加入教学班');
    await db.run(sql`INSERT INTO teaching_classes(course_id,term_id,teacher_id)
        SELECT ct.course_id,ct.term_id,${a.id} FROM course_terms ct JOIN terms t ON t.id=ct.term_id AND t.current=1
        WHERE ct.course_id=${courseId} AND ct.term_id=${termId} AND ${activeUser(a)} ON CONFLICT DO NOTHING`);
    if (!await db.get(sql`SELECT 1 WHERE ${classManagement(a, sql`${courseId}`, sql`${termId}`, sql`${a.id}`)}`)) {
        throw new HttpError(409, 'OFFERING_UNAVAILABLE', '只能加入管理员已安排开设的本学期课程');
    }
    return respond(c, await classDetail(c, courseId, termId, a.id));
});
classRoutes.get('/teaching-classes', async c => {
    const a = actor(c), p = page(c), courseId = c.req.query('courseId'), termId = c.req.query('termId');
    if (!['admin', 'teacher'].includes(a.role)) throw new HttpError(403, 'CLASS_PERMISSION_DENIED', '需要教师或管理员权限');
    const { rows, total } = await queryPage<ClassRow>(c, p, sql`${classSelect}
        WHERE ${classManagement(a, sql`tc.course_id`, sql`tc.term_id`, sql`tc.teacher_id`)}
        ${courseId === undefined ? sql`` : sql`AND tc.course_id=${courseId}`} ${termId === undefined ? sql`` : sql`AND tc.term_id=${termId}`}
        ORDER BY t.current DESC,tc.term_id DESC,tc.course_id,tc.teacher_id`);
    return respond(c, listResult(rows.map(classDto), p, total));
});
classRoutes.get(classPath, async c => {
    const { courseId, termId, teacherId } = await requireClass(c);
    return respond(c, await classDetail(c, courseId, termId, teacherId));
});
classRoutes.put(`${classPath}/bonus-policy`, async c => {
    const { a, courseId, termId, teacherId } = await requireClass(c);
    const data = await input(c, z.object({ pointsQuestion: pointsSchema, pointsAnswer: pointsSchema, pointsAcceptance: pointsSchema,
        pointsComment: pointsSchema, pointsMaterial: pointsSchema, pointsMaterialVersion: pointsSchema }).strict());
    assertChanged(await createDatabase(c.env.DB).run(sql`UPDATE class_bonus_rules SET points_question=${data.pointsQuestion},points_answer=${data.pointsAnswer},
        points_acceptance=${data.pointsAcceptance},points_comment=${data.pointsComment},points_material=${data.pointsMaterial},points_material_version=${data.pointsMaterialVersion}
        WHERE course_id=${courseId} AND term_id=${termId} AND teacher_id=${teacherId}
        AND ${classManagement(a, sql`class_bonus_rules.course_id`, sql`class_bonus_rules.term_id`, sql`class_bonus_rules.teacher_id`)}`));
    return respond(c, await classDetail(c, courseId, termId, teacherId));
});
classRoutes.get(`${classPath}/students`, async c => {
    const { a, courseId, termId, teacherId } = await requireClass(c), p = page(c);
    const { rows, total } = await queryPage(c, p, sql`SELECT a.id AS studentId,CASE WHEN a.status='deleted' THEN '已删除' ELSE a.nickname END AS nickname,
        a.status,a.school_number AS schoolNumber,a.name,a.department,a.major,a.grade FROM class_students s JOIN accounts a ON a.id=s.student_id
        WHERE s.course_id=${courseId} AND s.term_id=${termId} AND s.teacher_id=${teacherId}
        AND ${classManagement(a, sql`s.course_id`, sql`s.term_id`, sql`s.teacher_id`)} ORDER BY a.school_number,a.id`);
    return respond(c, listResult(rows, p, total));
});
classRoutes.post(`${classPath}/students`, async c => {
    const { a, courseId, termId, teacherId } = await requireClass(c), db = createDatabase(c.env.DB);
    const data = await input(c, z.object({ schoolNumber: z.string().trim().min(1).max(80) }).strict());
    const student = await db.get<{ id: string }>(sql`SELECT id FROM accounts WHERE school_number=${data.schoolNumber} AND role='student' AND status<>'deleted'`);
    if (!student) throw new HttpError(404, 'STUDENT_NOT_FOUND', '学生账号不存在，请先由管理员建立账号');
    await db.run(sql`INSERT INTO class_students(course_id,term_id,teacher_id,student_id)
        SELECT ${courseId},${termId},${teacherId},${student.id} WHERE EXISTS(SELECT 1 FROM terms WHERE id=${termId} AND current=1)
        AND ${classManagement(a, sql`${courseId}`, sql`${termId}`, sql`${teacherId}`)}
        AND EXISTS(SELECT 1 FROM accounts WHERE id=${student.id} AND role='student' AND status<>'deleted') ON CONFLICT DO NOTHING`);
    const assigned = await db.get(sql`SELECT 1 FROM class_students s JOIN terms t ON t.id=s.term_id AND t.current=1
        WHERE s.course_id=${courseId} AND s.term_id=${termId} AND s.teacher_id=${teacherId} AND s.student_id=${student.id}
        AND ${classManagement(a, sql`s.course_id`, sql`s.term_id`, sql`s.teacher_id`)}`);
    if (!assigned) throw new HttpError(409, 'STUDENT_ASSIGNMENT_CONFLICT', '学生已在本课程其他教师班中，或当前学期及操作权限已变化');
    return respond(c, { studentId: student.id });
});