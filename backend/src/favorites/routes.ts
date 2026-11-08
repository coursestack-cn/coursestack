import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { actor } from '../auth/middleware.ts';
import { activeUser } from '../permissions.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
import { courseIdSchema } from '../courses/validation.ts';
import { HttpError, idSchema, listResult, page, parsedEnum, queryPage, respond } from '../http.ts';
import { type AppEnv, type Ctx } from '../discussions/types.ts';

const types = ['course', 'material', 'question'] as const;
const targetSchema = z.object({ type: z.enum(types), id: z.string() }).strict().refine(
    target => (target.type === 'course' ? courseIdSchema : idSchema).safeParse(target.id).success,
    '收藏对象标识无效');
type Target = z.infer<typeof targetSchema>;
const fail = () => new HttpError(400, 'INVALID_FAVORITE_TARGET', '收藏对象类型或标识无效');
function target(c: Ctx): Target {
    const parsed = targetSchema.safeParse({ type: c.req.param('type'), id: c.req.param('targetId') });
    if (!parsed.success) throw fail();
    return parsed.data;
}
function match(t: Target) {
    return t.type === 'course' ? sql`f.course_id=${t.id}`
        : sql`f.content_id=${t.id} AND EXISTS(SELECT 1 FROM contents WHERE id=f.content_id AND kind=${t.type})`;
}
const kind = sql`CASE WHEN f.course_id IS NOT NULL THEN 'course' ELSE c.kind END`;
const from = sql`FROM favorites f LEFT JOIN contents c ON c.id=f.content_id
    LEFT JOIN public_contents p ON p.id=f.content_id JOIN courses course ON course.id=COALESCE(f.course_id,c.course_id)`;
type FavoriteRow = { favoriteId: number; type: Target['type']; targetId: string; createdAt: number;
    available: number; title: string | null; description: string | null; courseId: string; courseName: string };

export const favoriteRoutes = new Hono<AppEnv>();
favoriteRoutes.get('/me/favorites/status', async c => {
    const a = actor(c), raw = c.req.query('targets') ?? '';
    if (raw.length > 12000) throw fail();
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw fail(); }
    const parsed = z.array(targetSchema).min(1).max(50).safeParse(value);
    if (!parsed.success) throw fail();
    const targets = [...new Map(parsed.data.map(t => [JSON.stringify(t), t])).values()];
    const rows = await createDatabase(c.env.DB).all<{ type: Target['type']; course_id: string | null; content_id: string | null; created_at: number }>(sql`
        SELECT ${kind} AS type,f.course_id,f.content_id,f.created_at FROM favorites f LEFT JOIN contents c ON c.id=f.content_id
        WHERE f.account_id=${a.id} AND ${activeUser(a)}
        AND (${sql.join(targets.map(match), sql` OR `)})`);
    return respond(c, { viewer: a.id, items: targets.map(t => {
        const row = rows.find(r => r.type === t.type && (t.type === 'course' ? r.course_id === t.id : r.content_id === t.id));
        return { ...t, favorited: Boolean(row), createdAt: row?.created_at ?? null };
    }) });
});
favoriteRoutes.get('/me/favorites', async c => {
    const a = actor(c), pagination = page(c);
    const type = parsedEnum(c.req.query('type'), ['all', ...types] as const, 'all');
    const courseId = c.req.query('courseId');
    if (courseId !== undefined && !courseIdSchema.safeParse(courseId).success) throw fail();
    const owner = sql`f.account_id=${a.id} AND ${activeUser(a)}`;
    const filter = sql`${owner} ${courseId === undefined ? sql`` : sql`AND course.id=${courseId}`}`;
    const selected = sql`${filter} ${type === 'all' ? sql`` : sql`AND ${kind}=${type}`}`;
    const results = await c.env.DB.batch([
        sql`SELECT f.id AS favoriteId,${kind} AS type,COALESCE(f.course_id,f.content_id) AS targetId,f.created_at AS createdAt,
            (f.course_id IS NOT NULL OR p.id IS NOT NULL) AS available,
            CASE WHEN f.course_id IS NOT NULL THEN course.name ELSE p.title END AS title,
            CASE WHEN f.course_id IS NOT NULL THEN course.introduction ELSE NULL END AS description,
            course.id AS courseId,course.name AS courseName ${from} WHERE ${selected}
            ORDER BY f.created_at DESC,f.id DESC LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}`,
        sql`SELECT COUNT(*) AS total ${from} WHERE ${selected}`,
        sql`SELECT ${kind} AS type,COUNT(*) AS total ${from} WHERE ${filter} GROUP BY ${kind}`,
        sql`SELECT DISTINCT course.id,course.name ${from} WHERE ${owner} ORDER BY course.id`,
    ].map(s => prepareStatement(c.env.DB, s)));
    const counts = { all: 0, course: 0, material: 0, question: 0 };
    for (const row of results[2]!.results as { type: Target['type']; total: number }[]) {
        counts[row.type] = row.total; counts.all += row.total;
    }
    const items = (results[0]!.results as FavoriteRow[]).map(row => ({ ...row, available: Boolean(row.available) }));
    return respond(c, { ...listResult(items, pagination, (results[1]!.results[0] as { total: number }).total),
        viewer: a.id, counts, courses: results[3]!.results });
});
favoriteRoutes.put('/me/favorites/:type/:targetId', async c => {
    const a = actor(c), t = target(c);
    const available = t.type === 'course' ? sql`SELECT id FROM courses WHERE id=${t.id}`
        : sql`SELECT id FROM public_contents WHERE id=${t.id} AND kind=${t.type}`;
    const results = await c.env.DB.batch([
        sql`INSERT INTO favorites(account_id,course_id,content_id)
            SELECT ${a.id},${t.type === 'course' ? t.id : null},${t.type === 'course' ? null : t.id}
            WHERE ${activeUser(a)} AND EXISTS(${available}) ON CONFLICT DO NOTHING`,
        sql`SELECT f.created_at AS createdAt FROM favorites f WHERE f.account_id=${a.id} AND ${match(t)}
            AND ${activeUser(a)} AND EXISTS(${available})`,
    ].map(s => prepareStatement(c.env.DB, s)));
    const row = results[1]!.results[0] as { createdAt: number } | undefined;
    if (!row) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '收藏对象不存在或不可用');
    return respond(c, { ...t, favorited: true, createdAt: row.createdAt });
});
favoriteRoutes.delete('/me/favorites/:type/:targetId', async c => {
    const a = actor(c), t = target(c);
    await createDatabase(c.env.DB).run(sql`DELETE FROM favorites WHERE id IN (
        SELECT f.id FROM favorites f WHERE f.account_id=${a.id} AND ${match(t)} AND ${activeUser(a)})`);
    return respond(c, { ...t, favorited: false, createdAt: null });
});
favoriteRoutes.get('/me/feed', async c => {
    const a = actor(c), pagination = page(c);
    const sources = sql`SELECT course_id FROM teaching_classes JOIN terms ON terms.id=term_id
        WHERE teacher_id=${a.id} AND terms.current=1
        UNION SELECT course_id FROM class_students JOIN terms ON terms.id=term_id WHERE student_id=${a.id} AND terms.current=1
        UNION SELECT course_id FROM favorites WHERE account_id=${a.id} AND course_id IS NOT NULL`;
    const { rows, total } = await queryPage(c, pagination, sql`SELECT e.id,e.kind AS type,e.root_id AS contentId,root.kind,
        root.title,e.version,e.created_at AS createdAt,e.course_id AS courseId,course.name AS courseName
        FROM content_events e JOIN public_contents root ON root.id=e.root_id JOIN courses course ON course.id=e.course_id
        WHERE ${activeUser(a)} AND e.course_id IN (${sources}) AND e.kind IN ('question_created','material_created','material_version')
            AND (e.kind<>'material_version' OR EXISTS(SELECT 1 FROM file_versions v WHERE v.material_id=e.root_id AND v.version=e.version))
        ORDER BY e.created_at DESC,e.id DESC`);
    return respond(c, { ...listResult(rows, pagination, total), viewer: a.id });
});