import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { internalAuth } from '../auth/middleware.ts';
import { HttpError, respond, listResult, page, parsedEnum, queryPage } from '../http.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv, PublicRow } from '../discussions/types.ts';
import { parseBody } from '../discussions/body.ts';
import { contentDto, publicDetail, publicSelect } from '../discussions/service.ts';
import { createDatabase } from '../db/index.ts';

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
internalRoutes.get('/documents', async c => {
    const limit = Number(c.req.query('limit') ?? 50), after = c.req.query('after') ?? '';
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || after.length > 160) throw new HttpError(400, 'INVALID_CURSOR', 'limit 为 1–100，after 为上次的 nextCursor');
    const rows = await createDatabase(c.env.DB).all<{ documentId: string; id: string; kind: string; courseId: string; title: string | null;
        body: string | null; tags: string | null; targetKind: string | null; targetId: string | null; updatedAt: number }>(sql`
        SELECT * FROM (
            SELECT 'course:'||id AS documentId,id,'course' AS kind,id AS courseId,name AS title,introduction AS body,
                NULL AS tags,NULL AS targetKind,NULL AS targetId,updated_at AS updatedAt FROM courses
            UNION ALL
            SELECT kind||':'||id AS documentId,id,kind,course_id AS courseId,title,body,tags,target_kind AS targetKind,target_id AS targetId,updated_at AS updatedAt
                FROM public_contents WHERE kind IN ('material','question','answer')
        ) WHERE documentId>${after} ORDER BY documentId ASC LIMIT ${limit + 1}`);
    const items = rows.slice(0, limit).map(r => ({ ...r, body: r.kind === 'course' ? r.body : parseBody(r.body),
        format: r.kind === 'course' ? 'text' : 'prosemirror', tags: r.tags === null ? null : JSON.parse(r.tags) as string[] }));
    return respond(c, { items, nextCursor: items.at(-1)?.documentId ?? after, hasMore: rows.length > limit });
});
internalRoutes.get('/contents/:id', async c => {
    const visible = await createDatabase(c.env.DB).get(sql`SELECT id FROM public_contents WHERE id=${c.req.param('id')}`);
    if (!visible) return respond(c, { id: c.req.param('id'), available: false });
    return respond(c, { available: true, ...await publicDetail(c, c.req.param('id')) });
});