import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { internalAuth } from '../auth/middleware.ts';
import { HttpError, respond, input, listResult, page, parsedEnum, queryPage } from '../http.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv, PublicRow } from '../discussions/types.ts';
import { contentDto, publicDetail, publicSelect } from '../discussions/service.ts';
import { createDatabase } from '../db/index.ts';
const now = () => Math.floor(Date.now() / 1000);

export const personalRoutes = new Hono<AppEnv>();
personalRoutes.get('/me/activity', async c => {
    const a = actor(c), p = page(c);
    const kind = parsedEnum(c.req.query('kind'), ['material', 'question', 'answer', 'comment'] as const);
    const courseId = c.req.query('courseId');
    const { rows, total } = await queryPage<PublicRow>(c, p, sql`${publicSelect(c)} WHERE c.author_id=${a.id}
        ${kind ? sql`AND c.kind=${kind}` : sql``} ${courseId ? sql`AND c.course_id=${courseId}` : sql``}
        ORDER BY c.created_at DESC,c.id ASC`);
    return respond(c, listResult(rows.map(contentDto), p, total));
});

export const internalRoutes = new Hono<AppEnv>();
internalRoutes.use('*', internalAuth);
internalRoutes.get('/events', async c => {
    const query = z.object({ after: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(c.req.query());
    if (!query.success) throw new HttpError(400, 'INVALID_CURSOR', 'after 需为非负整数，limit 为 1–100');
    const { after, limit } = query.data;
    const rows = await createDatabase(c.env.DB).all<{ seq: number; event_id: string; type: string; course_id: string; content_id: string | null;
        actor_id: string; payload: string; created_at: number; acknowledged_at: number | null }>(sql`
        SELECT * FROM business_events WHERE seq>${after} ORDER BY seq ASC LIMIT ${limit + 1}`);
    const items = rows.slice(0, limit).map(r => ({ seq: r.seq, eventId: r.event_id, type: r.type, courseId: r.course_id,
        contentId: r.content_id, actorId: r.actor_id, payload: JSON.parse(r.payload), createdAt: r.created_at, acknowledgedAt: r.acknowledged_at }));
    return respond(c, { items, nextCursor: items.at(-1)?.seq ?? after, hasMore: rows.length > limit });
});
internalRoutes.post('/events/ack', async c => {
    const data = await input(c, z.object({ eventIds: z.array(z.string().min(1).max(180)).min(1).max(100) }).strict());
    const values = sql.join(data.eventIds.map(id => sql`${id}`), sql`, `);
    const result = await createDatabase(c.env.DB).run(sql`UPDATE business_events SET acknowledged_at=${now()} WHERE event_id IN (${values}) AND acknowledged_at IS NULL`);
    return respond(c, { acknowledged: result.meta.changes });
});
internalRoutes.get('/documents', async c => {
    const limit = Number(c.req.query('limit') ?? 50), after = c.req.query('after') ?? '';
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || after.length > 160) throw new HttpError(400, 'INVALID_CURSOR', 'limit 为 1–100，after 为上次的 nextCursor');
    // Read the watermark before the snapshot: consumer replays events > this value
    // after all pages to catch inserts, deletions and edits during pagination.
    const watermark = await createDatabase(c.env.DB).get<{ seq: number }>(sql`SELECT COALESCE(MAX(seq),0) AS seq FROM business_events`);
    const rows = await createDatabase(c.env.DB).all<{ documentId: string; id: string; kind: string; courseId: string; title: string | null;
        body: string; tags: string | null; targetKind: string | null; targetId: string | null; revision: number; updatedAt: number }>(sql`
        SELECT * FROM (
            SELECT 'course:'||id AS documentId,id,'course' AS kind,id AS courseId,name AS title,introduction AS body,
                NULL AS tags,NULL AS targetKind,NULL AS targetId,revision,COALESCE(updated_at,created_at) AS updatedAt FROM courses
            UNION ALL
            SELECT kind||':'||id AS documentId,id,kind,course_id AS courseId,title,body,tags,target_kind AS targetKind,target_id AS targetId,revision,updated_at AS updatedAt
                FROM public_contents WHERE kind IN ('material','question','answer')
        ) WHERE documentId>${after} ORDER BY documentId ASC LIMIT ${limit + 1}`);
    const items = rows.slice(0, limit).map(r => ({ ...r, tags: r.tags === null ? null : JSON.parse(r.tags) as string[] }));
    return respond(c, { items, nextCursor: items.at(-1)?.documentId ?? after, hasMore: rows.length > limit, watermark: watermark?.seq ?? 0 });
});
internalRoutes.get('/contents/:id', async c => {
    const visible = await createDatabase(c.env.DB).get(sql`SELECT id FROM public_contents WHERE id=${c.req.param('id')}`);
    if (!visible) return respond(c, { id: c.req.param('id'), available: false });
    return respond(c, { available: true, ...await publicDetail(c, c.req.param('id')) });
});