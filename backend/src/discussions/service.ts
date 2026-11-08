import { bodySearchText } from '../search/text.ts';
import { normalizeBodyImages, parseBody, bodySchema, jsonChanged, type ProseMirrorDocument } from './body.ts';
import { CONTENT_REQUEST_MAX_BYTES } from '../../../shared/rich-text/index.ts';
import { z } from 'zod';
import { sql, type SQL } from 'drizzle-orm';
import { ownerDeletionAllowed } from './deletion.ts';
import { createDatabase } from '../db/index.ts';
import { HttpError, input, tagsSchema, assertChanged } from '../http.ts';
import { materialEditInput } from '../materials/validation.ts';
import { actor } from '../auth/middleware.ts';
import { activeUser, editPermission } from '../permissions.ts';
import type { ContentRow, PublicRow, Ctx } from './types.ts';

export async function rawContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
    const row = await createDatabase(c.env.DB).get<ContentRow & { parent_kind: ContentRow['kind'] | null }>(sql`
        SELECT c.*,parent.kind AS parent_kind,a.answer_id AS acceptedAnswerId FROM contents c
        LEFT JOIN contents parent ON parent.id=c.target_id LEFT JOIN acceptances a ON a.question_id=c.id WHERE c.id=${id}`);
    if (!row || (kind && row.kind !== kind)) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return row;
}
export async function visibleContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
    const row = await createDatabase(c.env.DB).get<ContentRow>(sql`SELECT c.*,a.answer_id AS acceptedAnswerId FROM public_contents c LEFT JOIN acceptances a ON a.question_id=c.id WHERE c.id=${id}`);
    if (!row || (kind && row.kind !== kind)) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return row;
}
export async function readableContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
    const row = await rawContent(c, id, kind), viewer = c.get('actor');
    if (viewer && row.author_id === viewer.id && row.status !== 'deleted') {
        await requireEditor(c, row);
        return row;
    }
    return visibleContent(c, id, kind);
}
// Deleted comments keep their place in a thread; other deleted or hidden ancestors block the entire branch.
export async function accessibleContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
    const row = await createDatabase(c.env.DB).get<ContentRow>(sql`SELECT c.*,a.answer_id AS acceptedAnswerId FROM accessible_contents c LEFT JOIN acceptances a ON a.question_id=c.id WHERE c.id=${id}`);
    if (!row || (kind && row.kind !== kind)) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return row;
}
export async function tombstone(c: Ctx, id: string) {
    const row = await createDatabase(c.env.DB).get<PublicRow>(sql`${publicSelect(c, true)} WHERE c.id=${id} AND c.status='deleted'`);
    if (!row) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return tombstoneDto(row);
}
export function tombstoneDto(row: PublicRow) {
    return { id: row.id, kind: row.kind, courseId: row.course_id, targetKind: row.parent_kind,
        targetId: row.target_id, status: 'deleted', body: null, ...contentMetadata(row) };
}
export async function requireEditor(c: Ctx, row: ContentRow) {
    const a = actor(c);
    const allowed = await createDatabase(c.env.DB).get(sql`SELECT 1 WHERE ${editPermission(a, sql`${row.author_id}`)}`);
    if (!allowed) throw new HttpError(403, 'CONTENT_PERMISSION_DENIED', '只有内容所有者可以编辑内容');
    return a;
}
// Questions and materials are roots; answers belong to questions and comments to a question, answer or material.
// An ownership chain is therefore at most three levels deep, so visibility can be checked upwards per row
// instead of expanding the recursive public_contents view over the whole table.
export function publicContent(row: SQL): SQL {
    return sql`(${row}.status='visible' AND (${row}.target_id IS NULL OR EXISTS(SELECT 1 FROM contents ancestor
        WHERE ancestor.id=${row}.target_id AND ancestor.status='visible' AND (ancestor.target_id IS NULL OR EXISTS(SELECT 1
            FROM contents content_root WHERE content_root.id=ancestor.target_id AND content_root.status='visible' AND content_root.target_id IS NULL)))))`;
}
// Matches accessible_contents: a deleted comment stays reachable as a placeholder under a public parent.
function reachableContent(row: SQL): SQL {
    return sql`((${row}.target_id IS NULL AND ${row}.status='visible') OR (${row}.target_id IS NOT NULL
        AND (${row}.status='visible' OR (${row}.kind='comment' AND ${row}.status='deleted'))
        AND EXISTS(SELECT 1 FROM contents owner WHERE owner.id=${row}.target_id AND ${publicContent(sql`owner`)})))`;
}
export function publicSelect(c: Ctx, includeDeleted = false, source?: SQL) {
    const viewerId = c.get('actor')?.id ?? '';
    const visible = publicContent(sql`c`);
    return sql`SELECT c.*,(${viewerId}=c.author_id AND c.status<>'deleted' AND ${ownerDeletionAllowed(sql`c.id`)}) AS can_delete,${visible} AS publicly_visible,(SELECT kind FROM contents WHERE id=c.target_id) AS parent_kind,accepted.answer_id AS acceptedAnswerId,CASE WHEN u.status='deleted' THEN '已删除' ELSE u.nickname END AS author_name,
        CASE WHEN u.status='deleted' THEN NULL ELSE u.role END AS author_role,u.status='deleted' AS author_deleted,
        CASE WHEN u.status='active' THEN u.avatar_key ELSE NULL END AS author_avatar_key,
        EXISTS(SELECT 1 FROM teaching_classes ct JOIN terms term ON term.id=ct.term_id AND term.current=1
            WHERE ct.teacher_id=c.author_id AND ct.course_id=c.course_id AND u.role='teacher' AND u.status='active') AS course_teacher,
        COALESCE((SELECT SUM(v.value) FROM votes v WHERE v.content_id=c.id),0) AS score,
        COALESCE((SELECT value FROM votes v WHERE v.content_id=c.id AND v.user_id=${viewerId}),0) AS my_vote,
        parent.id AS reply_summary_id,CASE WHEN parent_author.status='deleted' THEN '已删除' ELSE parent_author.nickname END AS reply_to_name,
        parent_author.status='deleted' AS reply_to_author_deleted,parent.status<>'visible' AS reply_to_deleted,
        CASE WHEN c.kind='question' AND ${visible} THEN (SELECT COUNT(*) FROM contents answer
            WHERE answer.target_id=c.id AND answer.status='visible' AND answer.kind='answer') ELSE 0 END AS answer_count,
        CASE WHEN c.kind='comment' THEN CASE WHEN EXISTS(SELECT 1 FROM contents owner WHERE owner.id=c.target_id AND ${publicContent(sql`owner`)})
                THEN (SELECT COUNT(*) FROM contents reply WHERE reply.reply_to_id=c.id AND reply.status='visible' AND reply.kind='comment') ELSE 0 END
            WHEN ${visible} THEN (SELECT COUNT(*) FROM contents reply WHERE reply.target_id=c.id AND reply.status='visible' AND reply.kind='comment')
            ELSE 0 END AS comment_count
        FROM ${source ?? (includeDeleted ? sql`accessible_contents` : sql`public_contents`)} c JOIN accounts u ON u.id=c.author_id
        LEFT JOIN acceptances accepted ON accepted.question_id=c.id AND ${visible}
            AND EXISTS(SELECT 1 FROM contents accepted_answer WHERE accepted_answer.id=accepted.answer_id AND accepted_answer.status='visible')
        LEFT JOIN contents parent ON parent.id=COALESCE(c.reply_to_id,c.target_id) AND ${reachableContent(sql`parent`)}
        LEFT JOIN accounts parent_author ON parent_author.id=parent.author_id`;
}
export type RootSort = 'newest' | 'active' | 'score';
// For a public root question `c`, an accepted answer is public exactly when it is visible.
export const hasPublicAcceptance = sql`EXISTS(SELECT 1 FROM acceptances accepted_root
    JOIN contents accepted_answer ON accepted_answer.id=accepted_root.answer_id AND accepted_answer.status='visible'
    WHERE accepted_root.question_id=c.id)`;
// Lists public questions and materials of a course. `filter` refers to the root as `c`.
// Counting and ordering work on the roots alone, and only the selected page is projected.
export async function publicRootPage(c: Ctx, p: { pageSize: number; offset: number }, filter: SQL, sort: RootSort) {
    const roots = sql`FROM contents c WHERE c.target_id IS NULL AND c.status='visible' AND ${filter}`;
    const ranked = sort === 'active'
        ? sql`roots AS MATERIALIZED (SELECT c.id ${roots}),
            branch(root_id,id,updated_at) AS (
                SELECT roots.id,c.id,c.updated_at FROM roots JOIN contents c ON c.id=roots.id
                UNION ALL SELECT branch.root_id,child.id,child.updated_at FROM contents child JOIN branch ON child.target_id=branch.id
                WHERE child.status='visible' OR (child.kind='comment' AND child.status='deleted')
            ),
            ranked AS (SELECT root_id AS id,ROW_NUMBER() OVER (ORDER BY MAX(updated_at) DESC,root_id ASC) AS position FROM branch GROUP BY root_id)`
        : sql`ranked AS (SELECT c.id,ROW_NUMBER() OVER (ORDER BY ${sort === 'score'
            ? sql`COALESCE((SELECT SUM(v.value) FROM votes v WHERE v.content_id=c.id),0) DESC,c.created_at DESC,c.id ASC`
            : sql`c.created_at DESC,c.id ASC`}) AS position ${roots})`;
    const db = createDatabase(c.env.DB);
    const [count, rows] = await Promise.all([
        db.get<{ total: number }>(sql`SELECT COUNT(*) AS total ${roots}`),
        db.all<PublicRow>(sql`WITH RECURSIVE ${ranked},
            selected AS MATERIALIZED (SELECT id,position FROM ranked ORDER BY position LIMIT ${p.pageSize} OFFSET ${p.offset})
            ${publicSelect(c, false, sql`(SELECT contents.*,selected.position FROM selected JOIN contents ON contents.id=selected.id)`)}
            ORDER BY c.position`),
    ]);
    return { rows, total: count?.total ?? 0 };
}
export function ownedSelect(c: Ctx) {
    const a = actor(c);
    return publicSelect(c, false, sql`(SELECT * FROM contents WHERE author_id=${a.id} AND status<>'deleted' AND ${activeUser(a)})`);
}
export async function readableDetail(c: Ctx, id: string) {
    const a = c.get('actor');
    const row = await createDatabase(c.env.DB).get<PublicRow>(sql`${publicSelect(c, false, sql`contents`)} WHERE c.id=${id} AND c.status<>'deleted'
        AND (c.id IN (SELECT id FROM public_contents) ${a ? sql`OR ${editPermission(a, sql`c.author_id`)}` : sql``})`);
    if (!row) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return contentDto(row);
}
function contentMetadata(row: PublicRow) {
    return {
        termId: row.term_id,
        editedAt: row.edited_at,
        replyTo: row.reply_summary_id === null ? null : { id: row.reply_summary_id,
            author: { nickname: row.reply_to_name, isDeleted: Boolean(row.reply_to_author_deleted) }, isDeleted: Boolean(row.reply_to_deleted) },
        commentCount: Number(row.comment_count),
        ...(row.kind === 'question' ? { answerCount: Number(row.answer_count) } : {}),
    };
}
export function contentDto(row: PublicRow) {
    return {
        id: row.id, kind: row.kind, courseId: row.course_id, status: row.status, isPublic: Boolean(row.publicly_visible), canDelete: Boolean(row.can_delete),
        author: { id: row.author_id, nickname: row.author_name, isDeleted: Boolean(row.author_deleted),
            avatarUrl: row.author_avatar_key ? `/api/profiles/${encodeURIComponent(row.author_id)}/avatar` : null,
            isTeacher: row.author_role === 'teacher', isCourseTeacher: Boolean(row.course_teacher) },
        title: row.title, body: parseBody(row.body), format: 'prosemirror', tags: row.tags === null ? null : JSON.parse(row.tags) as string[],
        targetKind: row.parent_kind, targetId: row.target_id,
        createdAt: row.created_at, updatedAt: row.updated_at,
        ...contentMetadata(row),
        score: Number(row.score), myVote: Number(row.my_vote),
        ...(row.kind === 'question' ? { acceptedAnswerId: row.acceptedAnswerId, solved: row.acceptedAnswerId !== null } : {}),
    };
}
export async function publicDetail(c: Ctx, id: string) {
    const row = await createDatabase(c.env.DB).get<PublicRow>(sql`${publicSelect(c)} WHERE c.id=${id}`);
    if (!row) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return contentDto(row);
}

export async function editContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
    const row = await rawContent(c, id, kind), a = await requireEditor(c, row);
    if (row.status === 'deleted') throw new HttpError(409, 'DELETED_CONTENT', '已删除内容不能编辑');
    const schema = row.kind === 'material' ? materialEditInput : row.kind === 'question'
        ? z.object({ title: z.string().trim().min(1).max(200).optional(), body: bodySchema.optional(), tags: tagsSchema.nullable().optional() }).strict()
        : z.object({ body: bodySchema }).strict();
    const data = await input(c, schema, CONTENT_REQUEST_MAX_BYTES) as { title?: string; body?: ProseMirrorDocument; tags?: string[] | null };
    if (data.body) normalizeBodyImages(data.body, new URL(c.req.url).origin);
    const body = data.body === undefined ? undefined : JSON.stringify(data.body);
    const tags = data.tags === undefined ? undefined : data.tags?.length ? JSON.stringify(data.tags) : null;
    const bodyChanged = body === undefined ? sql`0` : jsonChanged(sql`body`, body);
    const tagsChanged = tags === undefined ? sql`0` : jsonChanged(sql`tags`, tags);
    const titleChanged = data.title === undefined ? sql`0` : sql`title IS NOT ${data.title}`, at = Math.floor(Date.now() / 1000);
    const result = await createDatabase(c.env.DB).run(sql`UPDATE contents SET title=${data.title ?? sql`title`},
        body=${body === undefined ? sql`body` : sql`CASE WHEN ${bodyChanged} THEN ${body} ELSE body END`},
        body_text=${data.body === undefined ? sql`body_text` : row.kind === 'comment' ? '' : bodySearchText(data.body)},
        tags=${tags === undefined ? sql`tags` : sql`CASE WHEN ${tagsChanged} THEN ${tags} ELSE tags END`},
        edited_at=CASE WHEN ${titleChanged} OR ${bodyChanged} OR ${tagsChanged} THEN ${at} ELSE edited_at END,
        updated_at=${at},updated_by=${a.id} WHERE id=${row.id} AND status<>'deleted'
        AND ${editPermission(a, sql`contents.author_id`)}`);
    assertChanged(result);
    return readableDetail(c, row.id);
}