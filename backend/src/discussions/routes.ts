import { CONTENT_REQUEST_MAX_BYTES } from '../../../shared/rich-text/index.ts';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, assertChanged, input, listResult, page, requestIdentity, idSchema, tagsSchema, parsedEnum, queryPage } from '../http.ts';
import { activeUser, editPermission } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv, Ctx, ContentRow, PublicRow } from '../discussions/types.ts';
import { accessibleContent, contentDto, publicDetail, publicSelect, requireEditor, tombstone, tombstoneDto, visibleContent } from '../discussions/service.ts';
import { bodySchema, jsonChanged, type ProseMirrorDocument } from './body.ts';
import { createDatabase } from '../db/index.ts';
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();
import { getCourse } from '../courses/routes.ts';

const questionInput = z.object({ title: z.string().trim().min(1).max(200), body: bodySchema,
    tags: tagsSchema.nullable().default(null) }).strict();
type NewContent = { kind: ContentRow['kind']; courseId: string; body: ProseMirrorDocument; title?: string;
    tags?: string[] | null; targetId?: string };
async function insertContent(c: Ctx, data: NewContent) {
    const a = actor(c), identity = await requestIdentity(c, data);
    const old = await createDatabase(c.env.DB).get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM contents WHERE author_id=${a.id} AND request_key=${identity.key}`);
    if (old) {
        if (old.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
        c.header('Idempotency-Replayed', 'true'); return old.id;
    }
    const id = uid(), at = now();
    await createDatabase(c.env.DB).run(sql`INSERT INTO contents(id,kind,course_id,author_id,title,body,tags,target_id,
        created_at,updated_at,updated_by,request_key,request_hash)
        SELECT ${id},${data.kind},${data.courseId},${a.id},${data.title ?? null},${JSON.stringify(data.body)},${data.tags?.length ? JSON.stringify(data.tags) : null},
        ${data.targetId ?? null},
        ${at},${at},${a.id},${identity.key},${identity.fingerprint} WHERE ${activeUser(a)}
        ON CONFLICT(author_id,request_key) DO NOTHING`);
    const made = await createDatabase(c.env.DB).get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM contents WHERE author_id=${a.id} AND request_key=${identity.key}`);
    if (!made) throw new HttpError(409, 'STATE_CONFLICT', '发布条件已改变');
    if (made.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    if (made.id !== id) c.header('Idempotency-Replayed', 'true');
    return made.id;
}
export const discussionRoutes = new Hono<AppEnv>();
discussionRoutes.get('/courses/:id/questions', async c => {
    const courseId = c.req.param('id'), p = page(c);
    await getCourse(c, courseId);
    const state = parsedEnum(c.req.query('state'), ['all', 'unresolved', 'solved'] as const, 'all');
    const sort = parsedEnum(c.req.query('sort'), ['newest', 'active', 'score'] as const, 'newest');
    const tag = c.req.query('tag');
    if (c.req.query('fileVersionId') !== undefined) throw new HttpError(400, 'INVALID_FILTER', '资料引用使用正文链接，不支持按文件版本筛选');
    if (tag && Array.from(tag).length > 30) throw new HttpError(400, 'INVALID_FILTER', '标签最长30字');
    const stateFilter = state === 'solved' ? sql`AND accepted.answer_id IS NOT NULL`
        : state === 'unresolved' ? sql`AND accepted.answer_id IS NULL` : sql``;
    const order = sort === 'score' ? sql`score DESC,c.created_at DESC,c.id ASC` : sort === 'active'
        ? sql`(WITH RECURSIVE activity(id,updated_at) AS (
                SELECT id,updated_at FROM accessible_contents WHERE id=c.id
                UNION ALL SELECT child.id,child.updated_at FROM accessible_contents child JOIN activity parent ON child.target_id=parent.id
            ) SELECT MAX(updated_at) FROM activity) DESC,c.id ASC`
        : sql`c.created_at DESC,c.id ASC`;
    const { rows, total } = await queryPage<PublicRow>(c, p, sql`${publicSelect(c)} WHERE c.kind='question' AND c.course_id=${courseId}
        ${stateFilter}
        ${tag ? sql`AND EXISTS(SELECT 1 FROM json_each(c.tags) WHERE value=${tag})` : sql``}
        ORDER BY ${order}`);
    return respond(c, listResult(rows.map(contentDto), p, total));
});
discussionRoutes.post('/courses/:id/questions', async c => {
    actor(c);
    const data = await input(c, questionInput, CONTENT_REQUEST_MAX_BYTES), courseId = c.req.param('id');
    await getCourse(c, courseId);
    const id = await insertContent(c, { kind: 'question', courseId, ...data });
    c.header('Location', `/api/questions/${id}`); return respond(c, { id }, 201);
});
discussionRoutes.get('/questions/:id', async c => {
    const row = await visibleContent(c, c.req.param('id'), 'question');
    return respond(c, await publicDetail(c, row.id));
});
discussionRoutes.get('/questions/:id/answers', async c => {
    const question = await visibleContent(c, c.req.param('id'), 'question'), p = page(c);
    const { rows, total } = await queryPage<PublicRow>(c, p, sql`${publicSelect(c)} WHERE c.kind='answer' AND c.target_id=${question.id}
        ORDER BY (c.id=${question.acceptedAnswerId}) DESC,score DESC,c.created_at ASC,c.id ASC`);
    return respond(c, listResult(rows.map(r => ({ ...contentDto(r), isAccepted: r.id === question.acceptedAnswerId })), p, total));
});
discussionRoutes.post('/questions/:id/answers', async c => {
    actor(c);
    const question = await visibleContent(c, c.req.param('id'), 'question');
    const data = await input(c, z.object({ body: bodySchema }).strict(), CONTENT_REQUEST_MAX_BYTES);
    const id = await insertContent(c, { kind: 'answer', courseId: question.course_id, targetId: question.id, body: data.body });
    c.header('Location', `/api/contents/${id}`); return respond(c, { id }, 201);
});
discussionRoutes.get('/comments', async c => {
    const kind = parsedEnum(c.req.query('targetKind'), ['material', 'question', 'answer', 'comment'] as const), targetId = c.req.query('targetId');
    if (!kind || !targetId || !idSchema.safeParse(targetId).success) throw new HttpError(400, 'TARGET_REQUIRED', '需要有效的 targetKind 和 targetId');
    await accessibleContent(c, targetId, kind);
    const p = page(c), sort = parsedEnum(c.req.query('sort'), ['oldest', 'score'] as const, 'oldest');
    const { rows, total } = await queryPage<PublicRow>(c, p, sql`WITH RECURSIVE thread(id) AS (
        SELECT id FROM accessible_contents WHERE kind='comment' AND target_id=${targetId}
        UNION ALL SELECT child.id FROM accessible_contents child JOIN thread parent ON child.target_id=parent.id WHERE child.kind='comment'
    ) ${publicSelect(c, true)} WHERE c.id IN (SELECT id FROM thread)
        AND (c.status='visible' OR EXISTS(WITH RECURSIVE below(id,status) AS (
            SELECT id,status FROM accessible_contents WHERE target_id=c.id
            UNION ALL SELECT child.id,child.status FROM accessible_contents child JOIN below parent ON child.target_id=parent.id
        ) SELECT 1 FROM below WHERE status='visible'))
        ORDER BY ${sort === 'score' ? sql`score DESC,` : sql``}c.created_at ASC,c.id ASC`);
    // A deleted comment is listed as a placeholder only while some reply below it is still visible.
    return respond(c, listResult(rows.map(r => r.status === 'deleted' ? tombstoneDto(r) : contentDto(r)), p, total));
});
discussionRoutes.post('/comments', async c => {
    actor(c);
    const data = await input(c, z.object({ targetKind: z.enum(['material', 'question', 'answer', 'comment']), targetId: idSchema,
        body: bodySchema }).strict(), CONTENT_REQUEST_MAX_BYTES);
    const courseId = (await visibleContent(c, data.targetId, data.targetKind)).course_id;
    const id = await insertContent(c, { kind: 'comment', courseId, targetId: data.targetId, body: data.body });
    c.header('Location', `/api/contents/${id}`); return respond(c, { id }, 201);
});
discussionRoutes.get('/contents/:id', async c => {
    const row = await accessibleContent(c, c.req.param('id'));
    if (row.status === 'deleted') return respond(c, await tombstone(c, row.id));
    return respond(c, await publicDetail(c, row.id));
});
discussionRoutes.patch('/contents/:id', async c => {
    const row = await visibleContent(c, c.req.param('id')), a = await requireEditor(c, row);
    const schema = row.kind === 'question' || row.kind === 'material' ? questionInput.pick({ title: true, body: true }).partial()
        .extend({ tags: tagsSchema.nullable().optional() }).strict() : z.object({ body: bodySchema }).strict();
    const data = await input(c, schema, CONTENT_REQUEST_MAX_BYTES) as { title?: string; body?: ProseMirrorDocument; tags?: string[] | null };
    const body = data.body === undefined ? undefined : JSON.stringify(data.body);
    const tags = data.tags === undefined ? undefined : data.tags?.length ? JSON.stringify(data.tags) : null;
    const bodyChanged = body === undefined ? sql`0` : jsonChanged(sql`body`, body);
    const tagsChanged = tags === undefined ? sql`0` : jsonChanged(sql`tags`, tags);
    const titleChanged = data.title === undefined ? sql`0` : sql`title IS NOT ${data.title}`, at = now();
    const result = await createDatabase(c.env.DB).run(sql`UPDATE contents SET title=${data.title ?? sql`title`},
        body=${body === undefined ? sql`body` : sql`CASE WHEN ${bodyChanged} THEN ${body} ELSE body END`},
        tags=${tags === undefined ? sql`tags` : sql`CASE WHEN ${tagsChanged} THEN ${tags} ELSE tags END`},
        edited_at=CASE WHEN ${titleChanged} OR ${bodyChanged} OR ${tagsChanged} THEN ${at} ELSE edited_at END,
        updated_at=${at},updated_by=${a.id} WHERE id=${row.id} AND id IN (SELECT id FROM public_contents)
        AND ${editPermission(a, sql`contents.course_id`, sql`contents.author_id`)}`);
    assertChanged(result); return respond(c, await publicDetail(c, row.id));
});
discussionRoutes.delete('/contents/:id', async c => {
    const row = await visibleContent(c, c.req.param('id')), a = await requireEditor(c, row);
    const result = await createDatabase(c.env.DB).run(sql`UPDATE contents SET status='deleted',body=NULL,tags=NULL,title=NULL,
        updated_at=${now()},updated_by=${a.id} WHERE id=${row.id}
        AND id IN (SELECT id FROM public_contents) AND ${editPermission(a, sql`contents.course_id`, sql`contents.author_id`)}`);
    assertChanged(result); return respond(c, { id: row.id, status: 'deleted' });
});
discussionRoutes.put('/contents/:id/vote', async c => {
    const a = actor(c), row = await visibleContent(c, c.req.param('id'));
    if (row.kind === 'material') throw new HttpError(400, 'VOTE_TARGET_INVALID', '赞踩仅适用于问题、回答和评论');
    const data = await input(c, z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }).strict());
    if (row.author_id === a.id) throw new HttpError(403, 'SELF_VOTE_FORBIDDEN', '不能给自己的内容投票');
    if (data.value === 0) {
        await createDatabase(c.env.DB).run(sql`DELETE FROM votes WHERE content_id=${row.id} AND user_id=${a.id} AND ${activeUser(a)}
            AND EXISTS(SELECT 1 FROM public_contents p WHERE p.id=${row.id})`);
    } else {
        const result = await createDatabase(c.env.DB).run(sql`INSERT INTO votes(content_id,user_id,value,created_at)
            SELECT id,${a.id},${data.value},${now()} FROM public_contents WHERE id=${row.id} AND author_id<>${a.id} AND ${activeUser(a)}
            ON CONFLICT(content_id,user_id) DO UPDATE SET value=excluded.value`);
        assertChanged(result);
    }
    const detail = await publicDetail(c, row.id);
    return respond(c, { id: row.id, score: detail.score, myVote: detail.myVote });
});