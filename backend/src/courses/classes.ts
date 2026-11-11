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
    // Switching back to an earlier term is allowed; the current term cannot be cleared.
    const a = await requireAdministrator(c), data = await input(c, z.object({ termId: idSchema }).strict());
    const db = createDatabase(c.env.DB);
    if (!await db.get(sql`SELECT 1 FROM terms WHERE id=${data.termId}`)) throw new HttpError(404, 'TERM_NOT_FOUND', '学期不存在');
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
    // The offering's foreign key requires its teaching classes to be removed first.
    await createDatabase(c.env.DB).run(sql`DELETE FROM course_terms WHERE course_id=${courseId} AND term_id=${termId} AND ${administration(a)}`);
    await requireAdministrator(c);
    return respond(c, { courseId, termId });
});
classRoutes.put('/courses/:id/terms/:termId/teachers/me', async c => {
    const a = actor(c), courseId = c.req.param('id'), termId = c.req.param('termId'), db = createDatabase(c.env.DB);
    if (a.role !== 'teacher') throw new HttpError(403, 'TEACHER_REQUIRED', '只有教师可以加入教学班');
    const offering = sql`FROM course_terms ct JOIN terms t ON t.id=ct.term_id AND t.current=1
        WHERE ct.course_id=${courseId} AND ct.term_id=${termId} AND ${activeUser(a)}`;
    await c.env.DB.batch([
        sql`INSERT INTO class_roster_events(action,course_id,term_id,teacher_id,operator_id)
            SELECT 'class_created',ct.course_id,ct.term_id,${a.id},${a.id} ${offering}
            AND NOT EXISTS(SELECT 1 FROM teaching_classes WHERE course_id=${courseId} AND term_id=${termId} AND teacher_id=${a.id})`,
        sql`INSERT INTO teaching_classes(course_id,term_id,teacher_id) SELECT ct.course_id,ct.term_id,${a.id} ${offering} ON CONFLICT DO NOTHING`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
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
type RosterEventRow = { id: number; action: string; course_id: string; course_name: string; term_id: string; term_name: string;
    teacher_id: string; teacher_name: string | null; teacher_deleted: number;
    target_teacher_id: string | null; target_teacher_name: string | null; target_teacher_deleted: number | null;
    student_id: string | null; student_number: string | null; student_name: string | null; student_deleted: number | null;
    operator_id: string; operator_role: string; operator_name: string | null; operator_deleted: number; created_at: number };
const person = (id: string, nickname: string | null, deleted: number | null) => ({ id, nickname: deleted ? '已删除' : nickname, isDeleted: Boolean(deleted) });
classRoutes.get('/admin/roster-events', async c => {
    const a = await requireAdministrator(c), p = page(c), { courseId, termId, teacherId, studentId } = c.req.query();
    const { rows, total } = await queryPage<RosterEventRow>(c, p, sql`SELECT e.id,e.action,e.course_id,c.name AS course_name,e.term_id,t.name AS term_name,
        e.teacher_id,teacher.nickname AS teacher_name,teacher.status='deleted' AS teacher_deleted,
        e.target_teacher_id,target.nickname AS target_teacher_name,target.status='deleted' AS target_teacher_deleted,
        e.student_id,student.school_number AS student_number,student.name AS student_name,student.status='deleted' AS student_deleted,
        e.operator_id,operator.role AS operator_role,operator.nickname AS operator_name,operator.status='deleted' AS operator_deleted,e.created_at
        FROM class_roster_events e JOIN courses c ON c.id=e.course_id JOIN terms t ON t.id=e.term_id
        JOIN accounts teacher ON teacher.id=e.teacher_id LEFT JOIN accounts target ON target.id=e.target_teacher_id
        LEFT JOIN accounts student ON student.id=e.student_id JOIN accounts operator ON operator.id=e.operator_id
        WHERE ${administration(a)} ${courseId === undefined ? sql`` : sql`AND e.course_id=${courseId}`}
        ${termId === undefined ? sql`` : sql`AND e.term_id=${termId}`} ${studentId === undefined ? sql`` : sql`AND e.student_id=${studentId}`}
        ${teacherId === undefined ? sql`` : sql`AND (e.teacher_id=${teacherId} OR e.target_teacher_id=${teacherId})`}
        ORDER BY e.id DESC`);
    return respond(c, listResult(rows.map(r => ({ id: r.id, action: r.action, course: { id: r.course_id, name: r.course_name },
        term: { id: r.term_id, name: r.term_name }, teacher: person(r.teacher_id, r.teacher_name, r.teacher_deleted),
        targetTeacher: r.target_teacher_id ? person(r.target_teacher_id, r.target_teacher_name, r.target_teacher_deleted) : null,
        student: r.student_id ? { id: r.student_id, schoolNumber: r.student_number, name: r.student_name, isDeleted: Boolean(r.student_deleted) } : null,
        operator: { ...person(r.operator_id, r.operator_name, r.operator_deleted), role: r.operator_role }, createdAt: r.created_at })), p, total));
});
classRoutes.get(classPath, async c => {
    const { courseId, termId, teacherId } = await requireClass(c);
    return respond(c, await classDetail(c, courseId, termId, teacherId));
});
classRoutes.delete(classPath, async c => {
    const a = await requireAdministrator(c), { courseId, termId, teacherId } = classKey(c);
    const target = sql`course_id=${courseId} AND term_id=${termId} AND teacher_id=${teacherId} AND ${administration(a)}`;
    // The deletion trigger removes the roster, so its students are recorded first in the same transaction.
    await c.env.DB.batch([
        sql`INSERT INTO class_roster_events(action,course_id,term_id,teacher_id,student_id,operator_id)
            SELECT 'student_removed',course_id,term_id,teacher_id,student_id,${a.id} FROM class_students WHERE ${target} ORDER BY student_id`,
        sql`INSERT INTO class_roster_events(action,course_id,term_id,teacher_id,operator_id)
            SELECT 'class_deleted',course_id,term_id,teacher_id,${a.id} FROM teaching_classes WHERE ${target}`,
        sql`DELETE FROM teaching_classes WHERE ${target}`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    await requireAdministrator(c);
    return respond(c, { courseId, termId, teacherId });
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
        a.status,a.school_number AS schoolNumber,a.name,a.department,a.major,a.grade,
        (SELECT COALESCE(SUM(l.delta_points),0) FROM bonus_ledger l WHERE l.course_id=s.course_id
            AND l.term_id=s.term_id AND l.teacher_id=s.teacher_id AND l.student_id=s.student_id) AS totalPoints
        FROM class_students s JOIN accounts a ON a.id=s.student_id
        WHERE s.course_id=${courseId} AND s.term_id=${termId} AND s.teacher_id=${teacherId}
        AND ${classManagement(a, sql`s.course_id`, sql`s.term_id`, sql`s.teacher_id`)} ORDER BY a.school_number,a.id`);
    return respond(c, listResult(rows, p, total));
});
classRoutes.post(`${classPath}/students`, async c => {
    const { a, courseId, termId, teacherId } = await requireClass(c), db = createDatabase(c.env.DB);
    const data = await input(c, z.object({ schoolNumber: z.string().trim().min(1).max(80) }).strict());
    const student = await db.get<{ id: string }>(sql`SELECT id FROM accounts WHERE school_number=${data.schoolNumber} AND role='student' AND status<>'deleted'`);
    if (!student) throw new HttpError(404, 'STUDENT_NOT_FOUND', '学生账号不存在，请先由管理员建立账号');
    const insertable = sql`EXISTS(SELECT 1 FROM terms WHERE id=${termId} AND current=1)
        AND ${classManagement(a, sql`${courseId}`, sql`${termId}`, sql`${teacherId}`)}
        AND EXISTS(SELECT 1 FROM accounts WHERE id=${student.id} AND role='student' AND status<>'deleted')`;
    await c.env.DB.batch([
        sql`INSERT INTO class_roster_events(action,course_id,term_id,teacher_id,student_id,operator_id)
            SELECT 'student_added',${courseId},${termId},${teacherId},${student.id},${a.id} WHERE ${insertable}
            AND NOT EXISTS(SELECT 1 FROM class_students WHERE course_id=${courseId} AND term_id=${termId} AND student_id=${student.id})`,
        sql`INSERT INTO class_students(course_id,term_id,teacher_id,student_id)
            SELECT ${courseId},${termId},${teacherId},${student.id} WHERE ${insertable} ON CONFLICT DO NOTHING`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    const assigned = await db.get(sql`SELECT 1 FROM class_students s JOIN terms t ON t.id=s.term_id AND t.current=1
        WHERE s.course_id=${courseId} AND s.term_id=${termId} AND s.teacher_id=${teacherId} AND s.student_id=${student.id}
        AND ${classManagement(a, sql`s.course_id`, sql`s.term_id`, sql`s.teacher_id`)}`);
    if (!assigned) throw new HttpError(409, 'STUDENT_ASSIGNMENT_CONFLICT', '学生已在本课程其他教师班中，或当前学期及操作权限已变化');
    return respond(c, { studentId: student.id });
});
const studentPath = `${classPath}/students/:studentId`;
classRoutes.delete(studentPath, async c => {
    const { a, courseId, termId, teacherId } = await requireClass(c), studentId = c.req.param('studentId');
    const enrollment = sql`course_id=${courseId} AND term_id=${termId} AND teacher_id=${teacherId} AND student_id=${studentId}
        AND ${classManagement(a, sql`class_students.course_id`, sql`class_students.term_id`, sql`class_students.teacher_id`)}`;
    const [, removed] = await c.env.DB.batch([
        sql`INSERT INTO class_roster_events(action,course_id,term_id,teacher_id,student_id,operator_id)
            SELECT 'student_removed',course_id,term_id,teacher_id,student_id,${a.id} FROM class_students WHERE ${enrollment}`,
        sql`DELETE FROM class_students WHERE ${enrollment}`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    if (!removed.meta.changes) await requireClass(c);
    return respond(c, { studentId });
});
classRoutes.put(`${studentPath}/transfer`, async c => {
    const a = await requireAdministrator(c), { courseId, termId, teacherId } = classKey(c), studentId = c.req.param('studentId');
    const { targetTeacherId } = await input(c, z.object({ targetTeacherId: idSchema }).strict());
    const targetExists = sql`EXISTS(SELECT 1 FROM teaching_classes tc JOIN accounts t ON t.id=tc.teacher_id AND t.status<>'deleted'
        WHERE tc.course_id=${courseId} AND tc.term_id=${termId} AND tc.teacher_id=${targetTeacherId})`;
    const moved = sql`course_id=${courseId} AND term_id=${termId} AND student_id=${studentId} AND teacher_id=${teacherId}
        AND teacher_id<>${targetTeacherId} AND ${targetExists} AND ${administration(a)}`;
    const [, , state] = await c.env.DB.batch<{ targetExists: number; assigned: string | null }>([
        sql`INSERT INTO class_roster_events(action,course_id,term_id,teacher_id,student_id,target_teacher_id,operator_id)
            SELECT 'student_transferred',course_id,term_id,teacher_id,student_id,${targetTeacherId},${a.id} FROM class_students WHERE ${moved}`,
        sql`UPDATE class_students SET teacher_id=${targetTeacherId} WHERE ${moved}`,
        sql`SELECT ${targetExists} AS targetExists,(SELECT teacher_id FROM class_students WHERE course_id=${courseId}
            AND term_id=${termId} AND student_id=${studentId}) AS assigned WHERE ${administration(a)}`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    const result = state.results[0];
    if (!result) throw new HttpError(403, 'ADMIN_REQUIRED', '需要管理员权限');
    if (!result.targetExists) throw new HttpError(404, 'TARGET_CLASS_NOT_FOUND', '该课程学期没有这个目标教学班');
    if (result.assigned == null) throw new HttpError(404, 'ENROLLMENT_NOT_FOUND', '学生已不在该课程学期的名单中');
    if (result.assigned !== targetTeacherId) throw new HttpError(409, 'STUDENT_ASSIGNMENT_CONFLICT', '学生已转到其他教学班，请刷新名单');
    return respond(c, { studentId, teacherId: targetTeacherId });
});
classRoutes.post(`${classPath}/students/import`, async c => {
    const { a, courseId, termId, teacherId } = await requireClass(c);
    const data = await input(c, z.object({ schoolNumbers: z.array(z.string()).min(1).max(500) }).strict());
    const numbers = data.schoolNumbers.map(number => number.trim()).filter(Boolean);
    if (!numbers.length) throw new HttpError(400, 'VALIDATION_ERROR', '至少填写一个学号');
    const unique = [...new Set(numbers)], valid = unique.filter(number => number.length <= 80);
    const payload = JSON.stringify(valid);
    const allowed = sql`EXISTS(SELECT 1 FROM teaching_classes tc JOIN terms t ON t.id=tc.term_id AND t.current=1
        WHERE tc.course_id=${courseId} AND tc.term_id=${termId} AND tc.teacher_id=${teacherId})
        AND ${classManagement(a, sql`${courseId}`, sql`${termId}`, sql`${teacherId}`)}`;
    // The write and result lookup share a transaction: concurrent imports cannot change the reported outcome.
    const [permission, , inserted, assigned] = await c.env.DB.batch([
        sql`SELECT (${allowed}) AS allowed`,
        sql`INSERT INTO class_roster_events(action,course_id,term_id,teacher_id,student_id,operator_id)
            SELECT 'student_added',${courseId},${termId},${teacherId},student.id,${a.id} FROM json_each(${payload}) n
            JOIN accounts student ON student.school_number=n.value AND student.role='student' AND student.status<>'deleted'
            WHERE ${allowed} AND NOT EXISTS(SELECT 1 FROM class_students s
                WHERE s.course_id=${courseId} AND s.term_id=${termId} AND s.student_id=student.id)`,
        sql`INSERT INTO class_students(course_id,term_id,teacher_id,student_id)
            SELECT ${courseId},${termId},${teacherId},student.id FROM json_each(${payload}) n
            JOIN accounts student ON student.school_number=n.value AND student.role='student' AND student.status<>'deleted'
            WHERE ${allowed} ON CONFLICT(course_id,term_id,student_id) DO NOTHING RETURNING student_id AS studentId`,
        sql`SELECT n.value AS schoolNumber,student.id AS studentId,s.teacher_id AS teacherId FROM json_each(${payload}) n
            LEFT JOIN accounts student ON student.school_number=n.value AND student.role='student' AND student.status<>'deleted'
            LEFT JOIN class_students s ON s.student_id=student.id AND s.course_id=${courseId} AND s.term_id=${termId}
            WHERE ${allowed}`,
    ].map(statement => prepareStatement(c.env.DB, statement))) as [D1Result<{ allowed: number }>, D1Result, D1Result<{ studentId: string }>,
        D1Result<{ schoolNumber: string; studentId: string | null; teacherId: string | null }>];
    if (!permission.results[0]?.allowed) throw new HttpError(409, 'CLASS_IMPORT_UNAVAILABLE', '当前学期、教学班或操作权限已变化，请刷新后重试');
    const added = new Set(inserted.results.map(row => row.studentId));
    const assignments = new Map(assigned.results.map(row => [row.schoolNumber, row]));
    const items = unique.map(schoolNumber => {
        const failure = (code: string, message: string) => ({ schoolNumber, status: 'failed' as const, code, message });
        if (schoolNumber.length > 80) return failure('INVALID_SCHOOL_NUMBER', '学号最多80个字符');
        const student = assignments.get(schoolNumber);
        if (!student?.studentId) return failure('STUDENT_NOT_FOUND', '学生账号不存在、已删除或不是学生');
        if (student.teacherId !== teacherId) return failure('STUDENT_ASSIGNMENT_CONFLICT', '学生已在本课程本学期其他教师的教学班中');
        return { schoolNumber, status: added.has(student.studentId) ? 'added' as const : 'existing' as const };
    });
    return respond(c, {
        addedCount: items.filter(item => item.status === 'added').length,
        existingCount: items.filter(item => item.status === 'existing').length,
        failedCount: items.filter(item => item.status === 'failed').length,
        duplicateCount: numbers.length - unique.length,
        items,
    });
});