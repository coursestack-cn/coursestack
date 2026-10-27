import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, assertChanged, input, listResult, page, pointsSchema, requestIdentity, idSchema, queryPage } from '../http.ts';
import { activeUser, management, requireManagement } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv, Ctx } from '../discussions/types.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();

const courseInput = z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().min(1).max(40),
    introduction: z.string().trim().max(5000).default('') }).strict();
type Course = { id: string; name: string; code: string; introduction: string;
    points_question: number; points_answer: number; points_acceptance: number; points_comment: number; points_material: number; points_material_version: number; created_at: number; updated_at: number; request_hash: string };
const courseSelect = sql`SELECT c.*,r.points_question,r.points_answer,r.points_acceptance,r.points_comment,r.points_material,r.points_material_version
    FROM courses c JOIN course_bonus_rules r ON r.id=c.id`;
export const courseDto = (r: Course) => ({ id: r.id, name: r.name, code: r.code,
    introduction: r.introduction, bonusPolicy: { pointsQuestion: r.points_question, pointsAnswer: r.points_answer,
        pointsAcceptance: r.points_acceptance, pointsComment: r.points_comment, pointsMaterial: r.points_material,
        pointsMaterialVersion: r.points_material_version },
    createdAt: r.created_at, updatedAt: r.updated_at });
export async function getCourse(c: Ctx, id: string) {
    const r = await createDatabase(c.env.DB).get<Course>(sql`${courseSelect} WHERE c.id=${id}`);
    if (!r) throw new HttpError(404, 'COURSE_NOT_FOUND', '课程不存在');
    return r;
}
export const courseRoutes = new Hono<AppEnv>();
courseRoutes.get('/courses', async c => {
    const p = page(c), q = (c.req.query('q') ?? '').trim();
    if (q.length > 100) throw new HttpError(400, 'INVALID_FILTER', '课程关键词最长 100 字');
    const { rows, total } = await queryPage<Course>(c, p, sql`${courseSelect}
        WHERE instr(c.name,${q})>0 OR instr(c.code,${q})>0 ORDER BY c.created_at DESC,c.id ASC`);
    return respond(c, listResult(rows.map(courseDto), p, total));
});
courseRoutes.post('/courses', async c => {
    const a = actor(c), data = await input(c, courseInput.extend({ teacherId: idSchema.optional() }).strict()), identity = await requestIdentity(c, data);
    if (!['teacher', 'admin'].includes(a.role)) throw new HttpError(403, 'TEACHER_REQUIRED', '只有教师或管理员可以创建课程');
    const existing = await createDatabase(c.env.DB).get<Pick<Course, 'id' | 'request_hash'>>(sql`SELECT id,request_hash FROM courses WHERE created_by=${a.id} AND request_key=${identity.key}`);
    if (existing) {
        if (existing.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
        c.header('Idempotency-Replayed', 'true'); return respond(c, { id: existing.id }, 201);
    }
    const sem = await createDatabase(c.env.DB).get<{ id: string }>(sql`SELECT id FROM terms WHERE current=1`);
    if (!sem) throw new HttpError(409, 'NO_CURRENT_TERM', '创建课程需先指定当前学期');
    const teacherId = data.teacherId ?? (a.role === 'teacher' ? a.id : undefined);
    if (!teacherId) throw new HttpError(400, 'TEACHER_REQUIRED', '管理员创建课程时必须指定 teacherId');
    if (a.role === 'teacher' && teacherId !== a.id) throw new HttpError(403, 'TEACHER_REQUIRED', '教师建课时必须由本人任教');
    const teacher = await createDatabase(c.env.DB).get(sql`SELECT id FROM accounts WHERE id=${teacherId} AND role='teacher' AND status<>'deleted'`);
    if (!teacher) throw new HttpError(400, 'TEACHER_REQUIRED', '任课教师不存在或已删除');
    const id = uid(), at = now();
    // Insert the teacher first; defer its course FK until this atomic batch commits.
    // The course INSERT trigger requires a teacher in the current term.
    await c.env.DB.batch([
        sql`PRAGMA defer_foreign_keys=ON`,
        sql`INSERT INTO enrollments(course_id,term_id,account_id)
            SELECT ${id},id,${teacherId} FROM terms WHERE id=${sem.id} AND current=1 AND ${activeUser(a)}
            AND NOT EXISTS(SELECT 1 FROM courses WHERE code=${data.code} OR (created_by=${a.id} AND request_key=${identity.key}))`,
        sql`INSERT INTO courses(id,name,code,introduction,created_by,updated_by,created_at,updated_at,request_key,request_hash)
            SELECT ${id},${data.name},${data.code},${data.introduction},${a.id},${a.id},${at},${at},${identity.key},${identity.fingerprint}
            WHERE EXISTS(SELECT 1 FROM enrollments WHERE course_id=${id} AND term_id=${sem.id} AND account_id=${teacherId})`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    const made = await createDatabase(c.env.DB).get<Pick<Course, 'id' | 'request_hash'>>(sql`SELECT id,request_hash FROM courses WHERE created_by=${a.id} AND request_key=${identity.key}`);
    if (!made) throw new HttpError(409, 'COURSE_CONFLICT', '课程编号已存在或创建条件已变化');
    if (made.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    if (made.id !== id) c.header('Idempotency-Replayed', 'true');
    c.header('Location', `/api/courses/${made.id}`);
    return respond(c, { id: made.id }, 201);
});
courseRoutes.get('/courses/:id', async c => respond(c, courseDto(await getCourse(c, c.req.param('id')))));
courseRoutes.patch('/courses/:id', async c => {
    const id = c.req.param('id'), a = await requireManagement(c, id);
    const data = await input(c, courseInput.pick({ name: true, code: true }).partial().extend({
        introduction: z.string().trim().max(5000).optional() }).strict());
    await getCourse(c, id);
    const result = await createDatabase(c.env.DB).run(sql`UPDATE courses SET name=${data.name ?? sql`name`},code=${data.code ?? sql`code`},
        introduction=${data.introduction ?? sql`introduction`},
        updated_by=${a.id},updated_at=${now()} WHERE id=${id} AND ${management(a, sql`courses.id`)}`);
    assertChanged(result); return respond(c, courseDto(await getCourse(c, id)));
});
courseRoutes.put('/courses/:id/bonus-policy', async c => {
    const id = c.req.param('id'), a = await requireManagement(c, id);
    const data = await input(c, z.object({ pointsQuestion: pointsSchema, pointsAnswer: pointsSchema,
        pointsAcceptance: pointsSchema, pointsComment: pointsSchema, pointsMaterial: pointsSchema, pointsMaterialVersion: pointsSchema }).strict());
    const result = await c.env.DB.batch([
        sql`UPDATE course_bonus_rules SET points_question=${data.pointsQuestion},points_answer=${data.pointsAnswer},
            points_acceptance=${data.pointsAcceptance},points_comment=${data.pointsComment},points_material=${data.pointsMaterial},points_material_version=${data.pointsMaterialVersion}
            WHERE id=${id} AND EXISTS(SELECT 1 FROM courses WHERE id=course_bonus_rules.id AND ${management(a, sql`courses.id`)})`,
        sql`UPDATE courses SET updated_by=${a.id},updated_at=${now()}
            WHERE id=${id} AND ${management(a, sql`courses.id`)}
            AND EXISTS(SELECT 1 FROM course_bonus_rules WHERE id=courses.id)`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    assertChanged(result[0]!); return respond(c, courseDto(await getCourse(c, id)));
});
courseRoutes.get('/courses/:id/entry', async c => {
    const id = c.req.param('id'), course = await getCourse(c, id);
    const viewer = c.get('actor');
    const canManage = viewer ? Boolean(await createDatabase(c.env.DB).get(sql`SELECT 1 WHERE ${management(viewer, sql`${id}`)}`)) : false;
    const summary = await createDatabase(c.env.DB).get<{ questions: number; unresolved: number; answers: number }>(sql`SELECT
        COUNT(CASE WHEN kind='question' THEN 1 END) AS questions,
        COUNT(CASE WHEN kind='question' AND NOT EXISTS(SELECT 1 FROM public_acceptances a WHERE a.question_id=public_contents.id) THEN 1 END) AS unresolved,
        COUNT(CASE WHEN kind='answer' THEN 1 END) AS answers FROM public_contents WHERE course_id=${id}`);
    return respond(c, { course: courseDto(course), summary, permissions: { canManage },
        links: { questions: `/api/courses/${id}/questions`, activity: `/api/courses/${id}/activity`,
            materials: `/api/materials?courseId=${id}` } });
});
courseRoutes.get('/courses/:id/activity', async c => {
    const id = c.req.param('id'), p = page(c);
    await getCourse(c, id);
    const { rows, total } = await queryPage<{ contentId: string; kind: string; title: string | null; createdAt: number; updatedAt: number }>(c, p, sql`
        SELECT id AS contentId,kind,title,created_at AS createdAt,updated_at AS updatedAt FROM public_contents
        WHERE course_id=${id} ORDER BY updated_at DESC,id DESC`);
    return respond(c, listResult(rows, p, total));
});