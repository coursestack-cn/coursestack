import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { internalAuth } from '../auth';
import { ApiError, actor, contentDto, db, input, listResult, now, page, parsedEnum, publicDetail,
  publicSelect, type AppEnv, type PublicRow } from '../core';

export const personalRoutes = new Hono<AppEnv>();
personalRoutes.get('/me/activity', async c => {
  const a = actor(c), p = page(c);
  const kind = parsedEnum(c.req.query('kind'), ['question', 'answer', 'comment'] as const);
  const courseId = c.req.query('courseId');
  const rows = await db(c).all<PublicRow>(sql`${publicSelect(c)} WHERE c.author_id=${a.id}
    ${kind ? sql`AND c.kind=${kind}` : sql``} ${courseId ? sql`AND c.course_id=${courseId}` : sql``}
    ORDER BY c.created_at DESC,c.id ASC LIMIT ${p.pageSize + 1} OFFSET ${p.offset}`);
  return c.json(listResult(rows.map(contentDto), p));
});

export const internalRoutes = new Hono<AppEnv>();
internalRoutes.use('*', internalAuth);
internalRoutes.get('/events', async c => {
  const query = z.object({ after: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(c.req.query());
  if (!query.success) throw new ApiError(400, 'INVALID_CURSOR', 'after 需为非负整数，limit 为 1–100');
  const { after, limit } = query.data;
  const rows = await db(c).all<{ seq: number; event_id: string; type: string; course_id: string; content_id: string | null;
    actor_id: string; payload: string; created_at: string; acknowledged_at: string | null }>(sql`
    SELECT * FROM business_events WHERE seq>${after} ORDER BY seq ASC LIMIT ${limit + 1}`);
  const items = rows.slice(0, limit).map(r => ({ seq: r.seq, eventId: r.event_id, type: r.type, courseId: r.course_id,
    contentId: r.content_id, actorId: r.actor_id, payload: JSON.parse(r.payload), createdAt: r.created_at, acknowledgedAt: r.acknowledged_at }));
  return c.json({ items, nextCursor: items.at(-1)?.seq ?? after, hasMore: rows.length > limit });
});
internalRoutes.post('/events/ack', async c => {
  const data = await input(c, z.object({ eventIds: z.array(z.string().min(1).max(180)).min(1).max(100) }).strict());
  const values = sql.join(data.eventIds.map(id => sql`${id}`), sql`, `);
  const result = await db(c).run(sql`UPDATE business_events SET acknowledged_at=${now()} WHERE event_id IN (${values}) AND acknowledged_at IS NULL`);
  return c.json({ acknowledged: result.meta.changes });
});
internalRoutes.get('/documents', async c => {
  const limit = Number(c.req.query('limit') ?? 50), after = c.req.query('after') ?? '';
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || after.length > 160) throw new ApiError(400, 'INVALID_CURSOR', 'limit 为 1–100，after 为上次的 nextCursor');
  // Read the watermark before the snapshot: consumer replays events > this value
  // after all pages to catch inserts, deletions and edits during pagination.
  const watermark = await db(c).get<{ seq: number }>(sql`SELECT COALESCE(MAX(seq),0) AS seq FROM business_events`);
  const rows = await db(c).all<{ documentId: string; id: string; kind: string; courseId: string; title: string | null;
    body: string; tags: string; questionId: string | null; revision: number; updatedAt: string }>(sql`
    SELECT * FROM (
      SELECT 'course:'||id AS documentId,id,'course' AS kind,id AS courseId,name AS title,introduction AS body,
        '[]' AS tags,NULL AS questionId,revision,updated_at AS updatedAt FROM courses
      UNION ALL
      SELECT kind||':'||id AS documentId,id,kind,course_id AS courseId,title,body,tags,question_id AS questionId,revision,updated_at AS updatedAt
        FROM public_contents WHERE kind IN ('question','answer')
    ) WHERE documentId>${after} ORDER BY documentId ASC LIMIT ${limit + 1}`);
  const items = rows.slice(0, limit).map(r => ({ ...r, tags: JSON.parse(r.tags) as string[] }));
  return c.json({ items, nextCursor: items.at(-1)?.documentId ?? after, hasMore: rows.length > limit, watermark: watermark?.seq ?? 0 });
});
internalRoutes.get('/contents/:id', async c => {
  const visible = await db(c).get(sql`SELECT id FROM public_contents WHERE id=${c.req.param('id')}`);
  if (!visible) return c.json({ id: c.req.param('id'), available: false });
  return c.json({ available: true, ...await publicDetail(c, c.req.param('id')) });
});