import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, assertChanged, idSchema, input, listResult, page, requestIdentity, queryPage, parsedEnum } from '../http.ts';
import { administration, management, requireAdministrator } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import { type AppEnv, type Ctx } from '../discussions/types.ts';
import { createDatabase } from '../db/index.ts';
import { courseIdSchema } from './validation.ts';
const now = () => Math.floor(Date.now() / 1000);
const courseInput = z.object({ id: courseIdSchema, name: z.string().trim().min(1).max(120),
    introduction: z.string().trim().max(5000).default('') }).strict();
type Course = { id: string; name: string; introduction: string; created_at: number; updated_at: number;
    term_id: string | null; term_name: string | null; offered: number; teachers: string };
const courseSelect = sql`SELECT c.*,term.id AS term_id,term.name AS term_name,
    EXISTS(SELECT 1 FROM course_terms offering WHERE offering.course_id=c.id AND offering.term_id=term.id) AS offered,
    (SELECT json_group_array(json_object('id',a.id,'nickname',CASE WHEN a.status='deleted' THEN '已删除' ELSE a.nickname END,
        'isDeleted',json(CASE WHEN a.status='deleted' THEN 'true' ELSE 'false' END))) FROM teaching_classes tc
        JOIN accounts a ON a.id=tc.teacher_id WHERE tc.course_id=c.id AND tc.term_id=term.id) AS teachers
    FROM courses c LEFT JOIN terms term ON term.current=1`;
export const courseDto = (r: Course) => ({ id: r.id, name: r.name, introduction: r.introduction,
    currentTerm: r.term_id ? { id: r.term_id, name: r.term_name } : null,
    offeredInCurrentTerm: Boolean(r.offered), currentTeachers: JSON.parse(r.teachers), createdAt: r.created_at, updatedAt: r.updated_at });
export async function getCourse(c: Ctx, id: string) {
    const r = await createDatabase(c.env.DB).get<Course>(sql`${courseSelect} WHERE c.id=${id}`);
    if (!r) throw new HttpError(404, 'COURSE_NOT_FOUND', '课程不存在');
    return r;
}
export const courseRoutes = new Hono<AppEnv>();
courseRoutes.get('/me/courses', async c => {
    const a = actor(c), p = page(c), q = (c.req.query('q') ?? '').trim();
    if (q.length > 100) throw new HttpError(400, 'INVALID_FILTER', '课程关键词最长 100 字');
    const scope = parsedEnum(c.req.query('scope'), ['current', 'history'] as const, 'current')!;
    const current = scope === 'current' ? 1 : 0;
    const memberships = sql`SELECT course_id,term_id FROM teaching_classes WHERE teacher_id=${a.id}
        UNION SELECT course_id,term_id FROM class_students WHERE student_id=${a.id}`;
    const db = createDatabase(c.env.DB);
    const [{ rows, total }, currentTerm] = await Promise.all([
        queryPage<Course>(c, p, sql`${courseSelect} WHERE EXISTS(SELECT 1 FROM (${memberships}) m
            JOIN terms t ON t.id=m.term_id WHERE m.course_id=c.id AND t.current=${current})
            AND (instr(c.name,${q})>0 OR instr(c.id,${q})>0) ORDER BY c.id`),
        db.get<{ id: string; name: string }>(sql`SELECT id,name FROM terms WHERE current=1`),
    ]);
    const terms = rows.length ? await db.all<{ courseId: string; id: string; name: string; current: number }>(sql`
        SELECT m.course_id AS courseId,t.id,t.name,t.current FROM (${memberships}) m JOIN terms t ON t.id=m.term_id
        WHERE t.current=${current} AND m.course_id IN (${sql.join(rows.map(row => sql`${row.id}`), sql`,`)}) ORDER BY t.id DESC`) : [];
    const items = rows.map(row => ({ course: courseDto(row), terms: terms.filter(term => term.courseId === row.id)
        .map(term => ({ id: term.id, name: term.name, current: Boolean(term.current) })) }));
    return respond(c, { ...listResult(items, p, total), scope, currentTerm: currentTerm ?? null });
});
courseRoutes.get('/courses', async c => {
    const p = page(c), q = (c.req.query('q') ?? '').trim(), id = c.req.query('id'), term = c.req.query('termId');
    if (c.req.query('code') !== undefined) throw new HttpError(400, 'INVALID_FILTER', '课程号请使用 id 参数');
    if (q.length > 100 || (id !== undefined && !courseIdSchema.safeParse(id).success)) throw new HttpError(400, 'INVALID_FILTER', '课程筛选无效');
    const { rows, total } = await queryPage<Course>(c, p, sql`${courseSelect}
        WHERE ${id === undefined ? sql`1` : sql`c.id=${id}`} AND (instr(c.name,${q})>0 OR instr(c.id,${q})>0)
        ${term === undefined ? sql`` : sql`AND EXISTS(SELECT 1 FROM course_terms ct WHERE ct.course_id=c.id AND ct.term_id=${term})`}
        ORDER BY c.created_at DESC,c.id ASC`);
    return respond(c, listResult(rows.map(courseDto), p, total));
});
courseRoutes.post('/courses', async c => {
    const a = await requireAdministrator(c), data = await input(c, courseInput), identity = await requestIdentity(c, data);
    const db = createDatabase(c.env.DB);
    const previous = () => db.get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM courses
        WHERE created_by=${a.id} AND request_key=${identity.key}`);
    const existing = await previous();
    if (!existing) await db.run(sql`INSERT INTO courses(id,name,introduction,created_by,created_at,updated_at,request_key,request_hash)
        SELECT ${data.id},${data.name},${data.introduction},${a.id},${now()},${now()},${identity.key},${identity.fingerprint}
        WHERE ${administration(a)} ON CONFLICT DO NOTHING`);
    const made = existing ?? await previous();
    if (!made) throw new HttpError(409, 'COURSE_CONFLICT', '课程号已存在或创建权限已变化');
    if (made.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    if (existing) c.header('Idempotency-Replayed', 'true');
    c.header('Location', `/api/courses/${encodeURIComponent(made.id)}`);
    return respond(c, { id: made.id }, 201);
});
courseRoutes.get('/courses/:id', async c => respond(c, courseDto(await getCourse(c, c.req.param('id')))));
courseRoutes.patch('/courses/:id', async c => {
    const id = c.req.param('id'), a = await requireAdministrator(c);
    const data = await input(c, courseInput.pick({ name: true }).partial().extend({ introduction: z.string().trim().max(5000).optional() }));
    await getCourse(c, id);
    const result = await createDatabase(c.env.DB).run(sql`UPDATE courses SET name=${data.name ?? sql`name`},
        introduction=${data.introduction ?? sql`introduction`},updated_at=${now()} WHERE id=${id} AND ${administration(a)}`);
    assertChanged(result); return respond(c, courseDto(await getCourse(c, id)));
});
courseRoutes.get('/courses/:id/entry', async c => {
    const id = c.req.param('id'), course = await getCourse(c, id), viewer = c.get('actor'), termId = c.req.query('termId');
    if (termId !== undefined && !idSchema.safeParse(termId).success) throw new HttpError(400, 'INVALID_FILTER', '学期无效');
    const db = createDatabase(c.env.DB);
    const terms = (await db.all<{ id: string; name: string; current: number }>(sql`SELECT * FROM terms ORDER BY current DESC,id DESC`))
        .map(term => ({ ...term, current: Boolean(term.current) }));
    const term = termId === undefined ? null : terms.find(item => item.id === termId);
    if (termId !== undefined && (!term || !await db.get(sql`SELECT 1 FROM course_terms WHERE course_id=${id} AND term_id=${termId}`))) {
        throw new HttpError(404, 'COURSE_TERM_NOT_FOUND', '该课程学期不存在');
    }
    const memberships = viewer ? await db.all<{ term_id: string }>(sql`SELECT term_id FROM class_students WHERE course_id=${id} AND student_id=${viewer.id}
        UNION SELECT term_id FROM teaching_classes WHERE course_id=${id} AND teacher_id=${viewer.id}`) : [];
    const myTerms = terms.filter(item => memberships.some(membership => membership.term_id === item.id));
    const teachers = term ? (await db.all<{ id: string; nickname: string | null; isDeleted: number }>(sql`
        SELECT a.id,CASE WHEN a.status='deleted' THEN '已删除' ELSE a.nickname END AS nickname,a.status='deleted' AS isDeleted
        FROM teaching_classes tc JOIN accounts a ON a.id=tc.teacher_id WHERE tc.course_id=${id} AND tc.term_id=${term.id} ORDER BY a.id`))
        .map(teacher => ({ ...teacher, isDeleted: Boolean(teacher.isDeleted) })) : JSON.parse(course.teachers);
    const canManageContent = viewer ? Boolean(await createDatabase(c.env.DB).get(sql`SELECT 1 WHERE ${management(viewer, sql`${id}`)}`)) : false;
    const summary = await createDatabase(c.env.DB).get<{ questions: number; unresolved: number; answers: number }>(sql`SELECT
        COUNT(CASE WHEN kind='question' THEN 1 END) AS questions,
        COUNT(CASE WHEN kind='question' AND NOT EXISTS(SELECT 1 FROM public_acceptances a WHERE a.question_id=public_contents.id) THEN 1 END) AS unresolved,
        COUNT(CASE WHEN kind='answer' THEN 1 END) AS answers FROM public_contents WHERE course_id=${id}`);
    const path = `/api/courses/${encodeURIComponent(id)}`;
    return respond(c, { course: courseDto(course), term: term ?? null, terms, myTerms, teachers, summary, permissions: { canManageContent, canManageCourse: viewer?.role === 'admin' },
        links: { questions: `${path}/questions`, activity: `${path}/activity`, materials: `${path}/contents?kind=material`, contents: `${path}/contents` } });
});
courseRoutes.get('/courses/:id/activity', async c => {
    const id = c.req.param('id'), p = page(c);
    await getCourse(c, id);
    const { rows, total } = await queryPage<{ contentId: string; kind: string; title: string | null; createdAt: number; updatedAt: number }>(c, p, sql`
        SELECT id AS contentId,kind,title,created_at AS createdAt,updated_at AS updatedAt FROM public_contents
        WHERE course_id=${id} ORDER BY updated_at DESC,id DESC`);
    return respond(c, listResult(rows, p, total));
});