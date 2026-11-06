import { Hono } from 'hono';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { actor } from '../auth/middleware.ts';
import { activeUser } from '../permissions.ts';
import { HttpError, input, respond } from '../http.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
import { type AppEnv, type Ctx } from '../discussions/types.ts';

const positiveId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const query = z.object({ status: z.enum(['unread', 'read', 'all']).default('unread'),
    beforeId: positiveId.optional(), pageSize: z.coerce.number().int().min(1).max(20).default(20) }).strict();
type NoticeRow = {
    id: number; type: string; contentId: string | null; kind: string | null; title: string | null;
    courseId: string; courseName: string; termId: string | null; createdAt: number; readAt: number | null;
    authorId: string | null; contentStatus: string | null; isPublic: number;
    status: string | null; version: number | null; reason: string | null; deltaPoints: number | null;
};

const notices = sql`SELECT n.id,n.kind AS type,n.content_id AS contentId,c.kind,c.title,
    COALESCE(c.course_id,l.course_id) AS courseId,course.name AS courseName,l.term_id AS termId,
    n.created_at AS createdAt,n.read_at AS readAt,c.author_id AS authorId,c.status AS contentStatus,
    EXISTS(SELECT 1 FROM public_contents p WHERE p.id=c.id) AS isPublic,
    m.new_status AS status,m.version,COALESCE(m.reason,l.reason) AS reason,l.delta_points AS deltaPoints
    FROM notifications n LEFT JOIN contents c ON c.id=n.content_id
    LEFT JOIN moderation_actions m ON n.kind='moderation' AND m.id=CAST(n.source_id AS INTEGER)
    LEFT JOIN bonus_ledger l ON n.kind='bonus' AND l.id=CAST(n.source_id AS INTEGER) AND l.student_id=n.account_id
    JOIN courses course ON course.id=COALESCE(c.course_id,l.course_id)`;

function dto(row: NoticeRow, viewer: string) {
    const isOwner = row.authorId === viewer;
    const available = Boolean(row.isPublic) || (isOwner && row.contentStatus !== 'deleted');
    const enc = encodeURIComponent;
    let href: string | null = null;
    if (row.type === 'bonus') href = `/courses/${enc(row.courseId)}?bonus=history&bonusTerm=${enc(row.termId!)}`;
    else if (row.type === 'moderation' && row.contentId) href = `/me/contents/${enc(row.contentId)}`;
    else if (row.contentId && available) href = isOwner && !row.isPublic ? `/me/contents/${enc(row.contentId)}`
        : `/${row.kind === 'material' ? 'materials' : row.kind === 'question' ? 'questions' : row.kind === 'answer' ? 'answers' : 'comments'}/${enc(row.contentId)}`;
    return { id: row.id, type: row.type, contentId: row.contentId, kind: row.kind,
        title: available ? row.title : null, courseId: row.courseId, courseName: row.courseName,
        createdAt: row.createdAt, readAt: row.readAt, available, isPublic: Boolean(row.isPublic),
        status: row.status, contentStatus: row.contentStatus, version: row.version, reason: row.reason ?? '', deltaPoints: row.deltaPoints, href };
}

function unread(c: Ctx) {
    const a = actor(c);
    return sql`SELECT COUNT(*) AS unreadCount FROM notifications WHERE account_id=${a.id} AND read_at IS NULL AND ${activeUser(a)}`;
}
function owner(c: Ctx) {
    const a = actor(c);
    return sql`n.account_id=${a.id} AND ${activeUser(a)}`;
}
async function select(c: Ctx, condition: SQL) {
    return createDatabase(c.env.DB).all<NoticeRow>(sql`${notices} WHERE ${owner(c)} AND ${condition} ORDER BY n.id DESC`);
}
export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get('/notifications/count', async c => {
    return respond(c, { viewer: actor(c).id, ...await createDatabase(c.env.DB).get<{ unreadCount: number }>(unread(c)) });
});
notificationRoutes.get('/notifications/state', async c => {
    const raw = c.req.query('ids') ?? '';
    if (!/^[1-9]\d*(,[1-9]\d*){0,19}$/.test(raw)) throw new HttpError(400, 'INVALID_FILTER', '每次查询1至20条通知');
    const ids = raw.split(',').map(Number);
    if (ids.some(id => !Number.isSafeInteger(id))) throw new HttpError(400, 'INVALID_FILTER', '通知ID无效');
    const rows = await select(c, sql`n.id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
    return respond(c, { viewer: actor(c).id, items: rows.map(row => dto(row, actor(c).id)) });
});
notificationRoutes.get('/notifications', async c => {
    const parsed = query.safeParse(c.req.query());
    if (!parsed.success) throw new HttpError(400, 'INVALID_FILTER', '通知筛选或游标无效');
    const { status, beforeId, pageSize } = parsed.data;
    const filter = status === 'unread' ? sql`AND n.read_at IS NULL` : status === 'read' ? sql`AND n.read_at IS NOT NULL` : sql``;
    const results = await c.env.DB.batch([
        sql`${notices} WHERE ${owner(c)} ${filter} ${beforeId === undefined ? sql`` : sql`AND n.id<${beforeId}`}
            ORDER BY n.id DESC LIMIT ${pageSize + 1}`,
        unread(c),
    ].map(s => prepareStatement(c.env.DB, s)));
    const rows = results[0]!.results as NoticeRow[], items = rows.slice(0, pageSize);
    return respond(c, { viewer: actor(c).id, items: items.map(row => dto(row, actor(c).id)),
        unreadCount: (results[1]!.results[0] as { unreadCount: number }).unreadCount,
        nextCursor: rows.length > pageSize ? items.at(-1)!.id : null, hasMore: rows.length > pageSize,
        readThroughId: items[0]?.id ?? null });
});
notificationRoutes.put('/notifications/read', async c => {
    const a = actor(c), { throughId } = await input(c, z.object({ throughId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict());
    const results = await c.env.DB.batch([
        sql`UPDATE notifications SET read_at=unixepoch() WHERE account_id=${a.id} AND id<=${throughId} AND read_at IS NULL AND ${activeUser(a)}`,
        unread(c),
    ].map(s => prepareStatement(c.env.DB, s)));
    return respond(c, { throughId, changed: results[0]!.meta.changes, ...(results[1]!.results[0] as { unreadCount: number }) });
});
notificationRoutes.put('/notifications/:id/read', async c => {
    const a = actor(c), parsed = positiveId.safeParse(c.req.param('id'));
    if (!parsed.success) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', '通知不存在');
    const id = parsed.data;
    const results = await c.env.DB.batch([
        sql`UPDATE notifications SET read_at=COALESCE(read_at,unixepoch()) WHERE id=${id} AND account_id=${a.id} AND ${activeUser(a)}`,
        sql`SELECT read_at AS readAt FROM notifications WHERE id=${id} AND account_id=${a.id} AND ${activeUser(a)}`,
        unread(c),
    ].map(s => prepareStatement(c.env.DB, s)));
    const row = results[1]!.results[0] as { readAt: number } | undefined;
    if (!row) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', '通知不存在');
    return respond(c, { id, read: true, readAt: row.readAt, ...(results[2]!.results[0] as { unreadCount: number }) });
});