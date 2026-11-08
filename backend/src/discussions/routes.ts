import { bodySearchText } from '../search/text.ts';
import { CONTENT_REQUEST_MAX_BYTES } from '../../../shared/rich-text/index.ts';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError, respond, assertChanged, input, listResult, page, requestIdentity, idSchema, tagsSchema, parsedEnum, queryPage } from '../http.ts';
import { activeUser, editPermission } from '../permissions.ts';
import { actor } from '../auth/middleware.ts';
import type { AppEnv, Ctx, ContentRow, PublicRow } from '../discussions/types.ts';
import { accessibleContent, contentDto, editContent, publicDetail, publicSelect, rawContent, readableContent, readableDetail, requireEditor, tombstone, tombstoneDto, visibleContent } from '../discussions/service.ts';
import { normalizeBodyImages, bodySchema, type ProseMirrorDocument } from './body.ts';
import { ownerDeletionAllowed, cleanupDeletedFiles } from './deletion.ts';
import { createDatabase, prepareStatement } from '../db/index.ts';
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();
import { getCourse } from '../courses/routes.ts';

const questionInput = z.object({ title: z.string().trim().min(1).max(200), body: bodySchema,
    tags: tagsSchema.nullable().default(null) }).strict();
type NewContent = { kind: ContentRow['kind']; courseId: string; body: ProseMirrorDocument; title?: string;
    tags?: string[] | null; targetId?: string; replyToId?: string };
async function insertContent(c: Ctx, data: NewContent) {
    normalizeBodyImages(data.body, new URL(c.req.url).origin);
    const a = actor(c), identity = await requestIdentity(c, data);
    const old = await createDatabase(c.env.DB).get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM contents WHERE author_id=${a.id} AND request_key=${identity.key}`);
    if (old) {
        if (old.request_hash !== identity.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
        c.header('Idempotency-Replayed', 'true'); return old.id;
    }
    const id = uid(), at = now();
    await createDatabase(c.env.DB).run(sql`INSERT INTO contents(id,kind,course_id,term_id,author_id,title,body,body_text,tags,target_id,reply_to_id,
        created_at,updated_at,updated_by,request_key,request_hash)
        SELECT ${id},${data.kind},${data.courseId},(SELECT id FROM terms WHERE current=1),${a.id},${data.title ?? null},${JSON.stringify(data.body)},${data.kind === 'comment' ? '' : bodySearchText(data.body)},${data.tags?.length ? JSON.stringify(data.tags) : null},
        ${data.targetId ?? null},${data.replyToId ?? null},
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
    const tag = c.req.query('tag'), termId = c.req.query('termId');
    if (termId !== undefined && !idSchema.safeParse(termId).success) throw new HttpError(400, 'INVALID_FILTER', '学期筛选无效');
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
        ${stateFilter} ${termId === undefined ? sql`` : sql`AND c.term_id=${termId}`}
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
    const row = await readableContent(c, c.req.param('id'), 'question');
    return respond(c, await readableDetail(c, row.id));
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
    const { rows, total } = await queryPage<PublicRow>(c, p, sql`${publicSelect(c, true)}
        WHERE c.kind='comment' AND ${kind === 'comment' ? sql`c.reply_to_id=${targetId}` : sql`c.target_id=${targetId}`}
        AND (c.status='visible' OR EXISTS(SELECT 1 FROM public_contents reply WHERE reply.reply_to_id=c.id))
        ORDER BY ${sort === 'score' ? sql`score DESC,` : sql``}c.created_at ASC,c.id ASC`);
    // A deleted comment is a placeholder only while a visible peer replies to it.
    return respond(c, listResult(rows.map(r => r.status === 'deleted' ? tombstoneDto(r) : contentDto(r)), p, total));
});
discussionRoutes.post('/comments', async c => {
    actor(c);
    const data = await input(c, z.object({ targetKind: z.enum(['material', 'question', 'answer', 'comment']), targetId: idSchema,
        body: bodySchema }).strict(), CONTENT_REQUEST_MAX_BYTES);
    const target = await visibleContent(c, data.targetId, data.targetKind);
    const id = await insertContent(c, { kind: 'comment', courseId: target.course_id,
        targetId: target.kind === 'comment' ? target.target_id! : target.id,
        replyToId: target.kind === 'comment' ? target.id : undefined, body: data.body });
    c.header('Location', `/api/contents/${id}`); return respond(c, { id }, 201);
});
discussionRoutes.get('/contents/:id', async c => {
    const row = await rawContent(c, c.req.param('id'));
    if (row.status === 'deleted') return respond(c, await tombstone(c, row.id));
    return respond(c, await readableDetail(c, row.id));
});
discussionRoutes.patch('/contents/:id', async c => {
    return respond(c, await editContent(c, c.req.param('id')));
});
discussionRoutes.delete('/contents/:id', async c => {
    const row = await rawContent(c, c.req.param('id')), a = await requireEditor(c, row);
    const allowed = sql`id=${row.id} AND status<>'deleted' AND ${editPermission(a, sql`contents.author_id`)}
        AND ${ownerDeletionAllowed(sql`contents.id`)}`;
    const results = await c.env.DB.batch<{ storage_key: string }>([
        sql`SELECT storage_key FROM file_versions WHERE material_id=${row.id} AND EXISTS(SELECT 1 FROM contents WHERE ${allowed})`,
        sql`UPDATE contents SET status='deleted',body=NULL,tags=NULL,title=NULL,updated_at=${now()},updated_by=${a.id} WHERE ${allowed}`,
    ].map(statement => prepareStatement(c.env.DB, statement)));
    if (!results[1]!.meta.changes) throw new HttpError(409, 'CONTENT_DELETE_BLOCKED', '已有回答、评论或采纳，或内容状态已变化；请联系课程教师或管理员处理');
    await cleanupDeletedFiles(c, results[0]!.results);
    return respond(c, { id: row.id, status: 'deleted' });
});
discussionRoutes.put('/contents/:id/vote', async c => {
    const a = actor(c), row = await visibleContent(c, c.req.param('id'));
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