import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, assertChanged, input, listResult, page, pointsSchema, requestIdentity, revisionSchema, idSchema, queryPage } from '../http.ts';
import { activeUser, management, requireManagement } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv, Ctx } from '../discussions/types.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();

const courseInput = z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().min(1).max(40),
    department: z.string().trim().max(120).default(''), introduction: z.string().trim().max(5000).default('') }).strict();
type Course = { id: string; name: string; code: string; department: string; introduction: string;
    bonus_enabled: number; bonus_cents: number; revision: number; created_at: number; updated_at: number | null; request_hash: string };
export const courseDto = (r: Course) => ({ id: r.id, name: r.name, code: r.code, department: r.department,
    introduction: r.introduction, bonusEnabled: Boolean(r.bonus_enabled), bonusPoints: r.bonus_cents / 100,
    revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at });
export async function getCourse(c: Ctx, id: string) {
    const r = await createDatabase(c.env.DB).get<Course>(sql`SELECT * FROM courses WHERE id=${id}`);
    if (!r) throw new HttpError(404, 'COURSE_NOT_FOUND', '课程不存在');
    return r;
}
export const courseRoutes = new Hono<AppEnv>();
courseRoutes.get('/courses', async c => {
    const p = page(c), q = (c.req.query('q') ?? '').trim();
    if (q.length > 100) throw new HttpError(400, 'INVALID_FILTER', '课程关键词最长 100 字');
    const { rows, total } = await queryPage<Course>(c, p, sql`SELECT * FROM courses
        WHERE instr(name,${q})>0 OR instr(code,${q})>0 ORDER BY created_at DESC,id ASC`);
    return respond(c, listResult(rows.map(courseDto), p, total));
});
courseRoutes.post('/courses', async c => {
    const a = actor(c), data = await input(c, courseInput.extend({ teacherId: idSchema.optional() }).strict()), identity = await requestIdentity(c, data);
    if (!['teacher', 'admin'].includes(a.role)) throw new HttpError(403, 'TEACHER_REQUIRED', '只有教师或管理员可以创建课程');
    const existing = await createDatabase(c.env.DB).get<Course>(sql`SELECT * FROM courses WHERE created_by=${a.id} AND request_key=${identity.key}`);
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
        sql`INSERT INTO courses(id,name,code,department,introduction,created_by,updated_by,created_at,updated_at,request_key,request_hash)
            SELECT ${id},${data.name},${data.code},${data.department},${data.introduction},${a.id},${a.id},${at},${at},${identity.key},${identity.fingerprint}
            WHERE EXISTS(SELECT 1 FROM enrollments WHERE course_id=${id} AND term_id=${sem.id} AND account_id=${teacherId})`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    const made = await createDatabase(c.env.DB).get<Course>(sql`SELECT * FROM courses WHERE created_by=${a.id} AND request_key=${identity.key}`);
    if (!made) throw new HttpError(409, 'COURSE_CONFLICT', '课程编号已存在或创建条件已变化');
    if (made.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    if (made.id !== id) c.header('Idempotency-Replayed', 'true');
    c.header('Location', `/api/courses/${made.id}`);
    return respond(c, { id: made.id }, 201);
});
courseRoutes.get('/courses/:id', async c => respond(c, courseDto(await getCourse(c, c.req.param('id')))));
courseRoutes.patch('/courses/:id', async c => {
    const id = c.req.param('id'), a = await requireManagement(c, id);
    const data = await input(c, courseInput.pick({ name: true, code: true }).partial().extend({ revision: revisionSchema,
        department: z.string().trim().max(120).optional(), introduction: z.string().trim().max(5000).optional() }).strict());
    const current = await getCourse(c, id);
    const result = await createDatabase(c.env.DB).run(sql`UPDATE courses SET name=${data.name ?? current.name},code=${data.code ?? current.code},
        department=${data.department ?? current.department},introduction=${data.introduction ?? current.introduction},
        updated_by=${a.id},updated_at=${now()},revision=revision+1 WHERE id=${id} AND revision=${data.revision} AND ${management(a, sql`courses.id`)}`);
    assertChanged(result); return respond(c, courseDto(await getCourse(c, id)));
});
courseRoutes.put('/courses/:id/bonus-policy', async c => {
    const id = c.req.param('id'), a = await requireManagement(c, id);
    const data = await input(c, z.object({ revision: revisionSchema, enabled: z.boolean(), bonusPoints: pointsSchema }).strict());
    const result = await createDatabase(c.env.DB).run(sql`UPDATE courses SET bonus_enabled=${Number(data.enabled)},bonus_cents=${Math.round(data.bonusPoints * 100)},
        revision=revision+1,updated_by=${a.id},updated_at=${now()} WHERE id=${id} AND revision=${data.revision} AND ${management(a, sql`courses.id`)}`);
    assertChanged(result); return respond(c, courseDto(await getCourse(c, id)));
});
courseRoutes.get('/courses/:id/entry', async c => {
    const id = c.req.param('id'), course = await getCourse(c, id);
    const viewer = c.get('actor');
    const canManage = viewer ? Boolean(await createDatabase(c.env.DB).get(sql`SELECT 1 WHERE ${management(viewer, sql`${id}`)}`)) : false;
    const summary = await createDatabase(c.env.DB).get<{ questions: number; unresolved: number; answers: number }>(sql`SELECT
        COUNT(CASE WHEN kind='question' THEN 1 END) AS questions,
        COUNT(CASE WHEN kind='question' AND accepted_answer_id IS NULL THEN 1 END) AS unresolved,
        COUNT(CASE WHEN kind='answer' THEN 1 END) AS answers FROM public_contents WHERE course_id=${id}`);
    return respond(c, { course: courseDto(course), summary, permissions: { canManage },
        links: { questions: `/api/courses/${id}/questions`, activity: `/api/courses/${id}/activity`,
            materials: `/api/materials?courseId=${id}` } });
});
courseRoutes.get('/courses/:id/activity', async c => {
    const id = c.req.param('id'), p = page(c);
    await getCourse(c, id);
    // Only references to content that is visible *now* are returned. Never expose
    // cached body/title data from the outbox after moderation.
    const { rows, total } = await queryPage<{ seq: number; type: string; content_id: string; created_at: number; kind: string; title: string | null }>(c, p, sql`
        SELECT e.seq,e.type,e.content_id,e.created_at,c.kind,c.title FROM business_events e
        JOIN public_contents c ON c.id=e.content_id WHERE e.course_id=${id}
        AND e.type NOT LIKE '%award%' AND e.type NOT LIKE '%hidden%' AND e.type NOT LIKE '%deleted%'
        ORDER BY e.seq DESC`);
    return respond(c, listResult(rows.map(r => ({ seq: r.seq, type: r.type, contentId: r.content_id, kind: r.kind,
        title: r.title, createdAt: r.created_at })), p, total));
});