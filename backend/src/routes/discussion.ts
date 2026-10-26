import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError, activeUser, actor, assertChanged, bodySchema, contentDto, db, editPermission, idSchema, input,
  listResult, now, page, parsedEnum, publicDetail, publicSelect, rawContent, requestIdentity, requireEditor,
  revisionSchema, tagsSchema, uid, visibleContent, type AppEnv, type Ctx, type ContentRow, type PublicRow } from '../core';
import { getCourse } from './courses';

const questionInput = z.object({ title: z.string().trim().min(1).max(200), body: bodySchema,
  tags: tagsSchema.default([]), fileVersionId: idSchema.nullable().default(null) }).strict();
type NewContent = { kind: ContentRow['kind']; courseId: string; body: string; title?: string;
  tags?: string[]; fileVersionId?: string | null; questionId?: string; targetKind?: string; targetId?: string; replyToId?: string | null };
async function insertContent(c: Ctx, data: NewContent) {
  const a = actor(c), identity = await requestIdentity(c, data);
  const old = await db(c).get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM contents WHERE author_id=${a.id} AND request_key=${identity.key}`);
  if (old) {
    if (old.request_hash !== identity.fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    c.header('Idempotency-Replayed', 'true'); return old.id;
  }
  const id = uid(), at = now();
  await db(c).run(sql`INSERT INTO contents(id,kind,course_id,author_id,title,body,tags,question_id,target_kind,target_id,
    reply_to_id,file_version_id,created_at,updated_at,updated_by,request_key,request_hash)
    SELECT ${id},${data.kind},${data.courseId},${a.id},${data.title ?? null},${data.body},${JSON.stringify(data.tags ?? [])},
    ${data.questionId ?? null},${data.targetKind ?? null},${data.targetId ?? null},${data.replyToId ?? null},${data.fileVersionId ?? null},
    ${at},${at},${a.id},${identity.key},${identity.fingerprint} WHERE ${activeUser(a)}
    ON CONFLICT(author_id,request_key) DO NOTHING`);
  const made = await db(c).get<{ id: string; request_hash: string }>(sql`SELECT id,request_hash FROM contents WHERE author_id=${a.id} AND request_key=${identity.key}`);
  if (!made) throw new ApiError(409, 'STATE_CONFLICT', '发布条件已改变');
  if (made.request_hash !== identity.fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
  if (made.id !== id) c.header('Idempotency-Replayed', 'true');
  return made.id;
}
async function commentTarget(c: Ctx, kind: string, id: string) {
  if (kind === 'material') {
    const m = await db(c).get<{ course_id: string }>(sql`SELECT course_id FROM materials WHERE id=${id} AND status='visible'`);
    if (!m) throw new ApiError(404, 'CONTENT_UNAVAILABLE', '资料不存在或不可用');
    return m.course_id;
  }
  return (await visibleContent(c, id, kind as 'question' | 'answer')).course_id;
}
export const discussionRoutes = new Hono<AppEnv>();
discussionRoutes.get('/courses/:id/questions', async c => {
  const courseId = c.req.param('id'), p = page(c);
  await getCourse(c, courseId);
  const state = parsedEnum(c.req.query('state'), ['all', 'unresolved', 'solved'] as const, 'all');
  const sort = parsedEnum(c.req.query('sort'), ['newest', 'active', 'score'] as const, 'newest');
  const version = c.req.query('fileVersionId'), tag = c.req.query('tag');
  if (version && !idSchema.safeParse(version).success) throw new ApiError(400, 'INVALID_FILTER', '文件版本 ID 无效');
  if (tag && tag.length > 30) throw new ApiError(400, 'INVALID_FILTER', '标签最长30字');
  const stateFilter = state === 'solved' ? sql`AND c.accepted_answer_id IS NOT NULL`
    : state === 'unresolved' ? sql`AND c.accepted_answer_id IS NULL` : sql``;
  const order = sort === 'score' ? sql`score DESC,c.created_at DESC,c.id ASC` : sort === 'active'
    ? sql`(SELECT MAX(p.updated_at) FROM public_contents p WHERE p.id=c.id OR p.question_id=c.id OR
        (p.kind='comment' AND (p.target_id=c.id OR p.target_id IN (SELECT id FROM public_contents WHERE question_id=c.id)))) DESC,c.id ASC`
    : sql`c.created_at DESC,c.id ASC`;
  const rows = await db(c).all<PublicRow>(sql`${publicSelect(c)} WHERE c.kind='question' AND c.course_id=${courseId}
    ${stateFilter} ${version ? sql`AND c.file_version_id=${version}` : sql``}
    ${tag ? sql`AND EXISTS(SELECT 1 FROM json_each(c.tags) WHERE value=${tag})` : sql``}
    ORDER BY ${order} LIMIT ${p.pageSize + 1} OFFSET ${p.offset}`);
  return c.json(listResult(rows.map(contentDto), p));
});
discussionRoutes.post('/courses/:id/questions', async c => {
  actor(c);
  const data = await input(c, questionInput), courseId = c.req.param('id');
  await getCourse(c, courseId);
  const id = await insertContent(c, { kind: 'question', courseId, ...data });
  c.header('Location', `/api/questions/${id}`); return c.json({ id }, 201);
});
discussionRoutes.get('/questions/:id', async c => {
  const row = await visibleContent(c, c.req.param('id'), 'question');
  let file: null | { id: string; available: boolean; materialId?: string; filename?: string; version?: number } = null;
  if (row.file_version_id) {
    const found = await db(c).get<{ materialId: string; filename: string; version: number }>(sql`
      SELECT m.id AS materialId,v.filename,v.version FROM file_versions v JOIN materials m ON m.id=v.material_id
      WHERE v.id=${row.file_version_id} AND v.status='visible' AND m.status='visible'`);
    file = found ? { id: row.file_version_id, available: true, ...found } : { id: row.file_version_id, available: false };
  }
  return c.json({ ...await publicDetail(c, row.id), file });
});
discussionRoutes.get('/questions/:id/answers', async c => {
  const question = await visibleContent(c, c.req.param('id'), 'question'), p = page(c);
  const rows = await db(c).all<PublicRow>(sql`${publicSelect(c)} WHERE c.kind='answer' AND c.question_id=${question.id}
    ORDER BY (c.id=${question.accepted_answer_id}) DESC,score DESC,c.created_at ASC,c.id ASC LIMIT ${p.pageSize + 1} OFFSET ${p.offset}`);
  return c.json(listResult(rows.map(r => ({ ...contentDto(r), isAccepted: r.id === question.accepted_answer_id })), p));
});
discussionRoutes.post('/questions/:id/answers', async c => {
  actor(c);
  const question = await visibleContent(c, c.req.param('id'), 'question');
  const data = await input(c, z.object({ body: bodySchema }).strict());
  const id = await insertContent(c, { kind: 'answer', courseId: question.course_id, questionId: question.id, body: data.body });
  c.header('Location', `/api/contents/${id}`); return c.json({ id }, 201);
});
discussionRoutes.get('/comments', async c => {
  const kind = parsedEnum(c.req.query('targetKind'), ['material', 'question', 'answer'] as const), targetId = c.req.query('targetId');
  if (!kind || !targetId || !idSchema.safeParse(targetId).success) throw new ApiError(400, 'TARGET_REQUIRED', '需要有效的 targetKind 和 targetId');
  await commentTarget(c, kind, targetId);
  const p = page(c), sort = parsedEnum(c.req.query('sort'), ['oldest', 'score'] as const, 'oldest');
  const rows = await db(c).all<PublicRow>(sql`${publicSelect(c)} WHERE c.kind='comment' AND c.target_kind=${kind} AND c.target_id=${targetId}
    ORDER BY ${sort === 'score' ? sql`score DESC,` : sql``}c.created_at ASC,c.id ASC LIMIT ${p.pageSize + 1} OFFSET ${p.offset}`);
  return c.json(listResult(rows.map(contentDto), p));
});
discussionRoutes.post('/comments', async c => {
  actor(c);
  const data = await input(c, z.object({ targetKind: z.enum(['material', 'question', 'answer']), targetId: idSchema,
    body: bodySchema, replyToId: idSchema.nullable().default(null) }).strict());
  const courseId = await commentTarget(c, data.targetKind, data.targetId);
  const id = await insertContent(c, { kind: 'comment', courseId, ...data });
  c.header('Location', `/api/contents/${id}`); return c.json({ id }, 201);
});
discussionRoutes.get('/contents/:id', async c => {
  const row = await rawContent(c, c.req.param('id'));
  if (row.status === 'deleted') {
    // The tombstone contains no body, name, tags or file metadata.
    if (row.kind === 'answer') await visibleContent(c, row.question_id!, 'question');
    if (row.kind === 'comment') await commentTarget(c, row.target_kind!, row.target_id!);
    return c.json({ id: row.id, kind: row.kind, status: 'deleted', body: null, revision: row.revision });
  }
  return c.json(await publicDetail(c, row.id));
});
discussionRoutes.patch('/contents/:id', async c => {
  const row = await visibleContent(c, c.req.param('id')), a = await requireEditor(c, row);
  const schema = row.kind === 'question' ? questionInput.pick({ title: true, body: true }).partial().extend({ revision: revisionSchema,
    tags: tagsSchema.optional(), fileVersionId: idSchema.nullable().optional() }).strict()
    : z.object({ revision: revisionSchema, body: bodySchema }).strict();
  const data = await input(c, schema) as { revision: number; title?: string; body?: string; tags?: string[]; fileVersionId?: string | null };
  const result = await db(c).run(sql`UPDATE contents SET title=${data.title ?? row.title},body=${data.body ?? row.body},
    tags=${data.tags ? JSON.stringify(data.tags) : row.tags},
    file_version_id=${data.fileVersionId === undefined ? row.file_version_id : data.fileVersionId},
    updated_at=${now()},updated_by=${a.id},change_reason='edited',revision=revision+1
    WHERE id=${row.id} AND revision=${data.revision} AND id IN (SELECT id FROM public_contents)
    AND ${editPermission(a, sql`contents.course_id`, sql`contents.author_id`)}`);
  assertChanged(result); return c.json(await publicDetail(c, row.id));
});
discussionRoutes.delete('/contents/:id', async c => {
  const row = await visibleContent(c, c.req.param('id')), a = await requireEditor(c, row);
  const data = await input(c, z.object({ revision: revisionSchema }).strict());
  const result = await db(c).run(sql`UPDATE contents SET status='deleted',revision=revision+1,updated_at=${now()},updated_by=${a.id},
    change_reason='author.deleted',accepted_answer_id=NULL,accepted_by=NULL,accepted_at=NULL,accepted_semester_id=NULL,
    acceptance_id=NULL,award_cents=0,award_eligible=0 WHERE id=${row.id} AND revision=${data.revision}
    AND id IN (SELECT id FROM public_contents) AND ${editPermission(a, sql`contents.course_id`, sql`contents.author_id`)}`);
  assertChanged(result); return c.json({ id: row.id, status: 'deleted', revision: data.revision + 1 });
});
discussionRoutes.put('/contents/:id/vote', async c => {
  const a = actor(c), row = await visibleContent(c, c.req.param('id'));
  const data = await input(c, z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }).strict());
  if (row.author_id === a.id) throw new ApiError(403, 'SELF_VOTE_FORBIDDEN', '不能给自己的内容投票');
  if (data.value === 0) {
    await db(c).run(sql`DELETE FROM votes WHERE content_id=${row.id} AND user_id=${a.id} AND ${activeUser(a)}
      AND EXISTS(SELECT 1 FROM public_contents p WHERE p.id=${row.id})`);
  } else {
    const result = await db(c).run(sql`INSERT INTO votes(content_id,user_id,value,updated_at)
      SELECT id,${a.id},${data.value},${now()} FROM public_contents WHERE id=${row.id} AND author_id<>${a.id} AND ${activeUser(a)}
      ON CONFLICT(content_id,user_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);
    assertChanged(result);
  }
  const detail = await publicDetail(c, row.id);
  return c.json({ id: row.id, score: detail.score, myVote: detail.myVote });
});