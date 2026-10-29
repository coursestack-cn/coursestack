import { parseBody } from './body.ts';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { HttpError } from '../http.ts';
import { actor } from '../auth/middleware.ts';
import { editPermission } from '../permissions.ts';
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
    const allowed = await createDatabase(c.env.DB).get(sql`SELECT 1 WHERE ${editPermission(a, sql`${row.course_id}`, sql`${row.author_id}`)}`);
    if (!allowed) throw new HttpError(403, 'CONTENT_PERMISSION_DENIED', '只能维护自己的内容或所管理课程的内容');
    return a;
}
export function publicSelect(c: Ctx, includeDeleted = false) {
    const viewerId = c.get('actor')?.id ?? '';
    return sql`SELECT c.*,parent.kind AS parent_kind,accepted.answer_id AS acceptedAnswerId,CASE WHEN u.status='deleted' THEN '已删除' ELSE u.nickname END AS author_name,
        CASE WHEN u.status='deleted' THEN NULL ELSE u.role END AS author_role,u.status='deleted' AS author_deleted,
        EXISTS(SELECT 1 FROM enrollments ct JOIN terms term ON term.id=ct.term_id AND term.current=1
            WHERE ct.account_id=c.author_id AND ct.course_id=c.course_id AND u.role='teacher' AND u.status='active') AS course_teacher,
        COALESCE((SELECT SUM(v.value) FROM votes v WHERE v.content_id=c.id),0) AS score,
        COALESCE((SELECT value FROM votes v WHERE v.content_id=c.id AND v.user_id=${viewerId}),0) AS my_vote,
        parent.id AS reply_to_id,CASE WHEN parent_author.status='deleted' THEN '已删除' ELSE parent_author.nickname END AS reply_to_name,
        parent_author.status='deleted' AS reply_to_author_deleted,parent.status='deleted' AS reply_to_deleted,
        CASE WHEN c.kind='question' THEN (SELECT COUNT(*) FROM public_contents answer
            WHERE answer.kind='answer' AND answer.target_id=c.id) ELSE 0 END AS answer_count,
        (WITH RECURSIVE replies(id,status) AS (
            SELECT id,status FROM accessible_contents WHERE kind='comment' AND target_id=c.id
            UNION ALL SELECT child.id,child.status FROM accessible_contents child JOIN replies p ON child.target_id=p.id WHERE child.kind='comment'
        ) SELECT COUNT(*) FROM replies WHERE status='visible') AS comment_count
        FROM ${includeDeleted ? sql`accessible_contents` : sql`public_contents`} c JOIN accounts u ON u.id=c.author_id
        LEFT JOIN public_acceptances accepted ON accepted.question_id=c.id
        LEFT JOIN accessible_contents parent ON parent.id=c.target_id LEFT JOIN accounts parent_author ON parent_author.id=parent.author_id`;
}
function contentMetadata(row: PublicRow) {
    return {
        editedAt: row.edited_at,
        replyTo: row.reply_to_id === null ? null : { id: row.reply_to_id,
            author: { nickname: row.reply_to_name, isDeleted: Boolean(row.reply_to_author_deleted) }, isDeleted: Boolean(row.reply_to_deleted) },
        commentCount: Number(row.comment_count),
        ...(row.kind === 'question' ? { answerCount: Number(row.answer_count) } : {}),
    };
}
export function contentDto(row: PublicRow) {
    return {
        id: row.id, kind: row.kind, courseId: row.course_id,
        author: { id: row.author_id, nickname: row.author_name, isDeleted: Boolean(row.author_deleted),
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