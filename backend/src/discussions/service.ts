import { parseBody } from './body.ts';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { HttpError } from '../http.ts';
import { actor } from '../auth/middleware.ts';
import { editPermission } from '../permissions.ts';
import type { ContentRow, PublicRow, Ctx } from './types.ts';

export async function rawContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
    const row = await createDatabase(c.env.DB).get<ContentRow>(sql`SELECT c.*,a.answer_id AS acceptedAnswerId FROM contents c LEFT JOIN acceptances a ON a.question_id=c.id WHERE c.id=${id}`);
    if (!row || (kind && row.kind !== kind)) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return row;
}
export async function visibleContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
    const row = await createDatabase(c.env.DB).get<ContentRow>(sql`SELECT c.*,a.answer_id AS acceptedAnswerId FROM public_contents c LEFT JOIN acceptances a ON a.question_id=c.id WHERE c.id=${id}`);
    if (!row || (kind && row.kind !== kind)) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return row;
}
// Deleted parents keep their place in a thread; hidden ancestors block the entire branch.
export async function accessibleContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
    const row = await createDatabase(c.env.DB).get<ContentRow>(sql`SELECT c.*,a.answer_id AS acceptedAnswerId FROM accessible_contents c LEFT JOIN acceptances a ON a.question_id=c.id WHERE c.id=${id}`);
    if (!row || (kind && row.kind !== kind)) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return row;
}
export function tombstone(row: ContentRow) {
    return { id: row.id, kind: row.kind, courseId: row.course_id, targetKind: row.target_kind,
        targetId: row.target_id, status: 'deleted', body: null, revision: row.revision };
}
export async function requireEditor(c: Ctx, row: ContentRow) {
    const a = actor(c);
    const allowed = await createDatabase(c.env.DB).get(sql`SELECT 1 WHERE ${editPermission(a, sql`${row.course_id}`, sql`${row.author_id}`)}`);
    if (!allowed) throw new HttpError(403, 'CONTENT_PERMISSION_DENIED', '只能维护自己的内容或所管理课程的内容');
    return a;
}
export function publicSelect(c: Ctx) {
    const viewerId = c.get('actor')?.id ?? '';
    return sql`SELECT c.*,accepted.answer_id AS acceptedAnswerId,CASE WHEN u.status='deleted' THEN '已删除' ELSE u.nickname END AS author_name,
        CASE WHEN u.status='deleted' THEN NULL ELSE u.role END AS author_role,u.status='deleted' AS author_deleted,
        EXISTS(SELECT 1 FROM enrollments ct JOIN terms term ON term.id=ct.term_id AND term.current=1
            WHERE ct.account_id=c.author_id AND ct.course_id=c.course_id AND u.role='teacher' AND u.status='active') AS course_teacher,
        COALESCE((SELECT SUM(v.value) FROM votes v WHERE v.content_id=c.id),0) AS score,
        COALESCE((SELECT value FROM votes v WHERE v.content_id=c.id AND v.user_id=${viewerId}),0) AS my_vote
        FROM public_contents c JOIN accounts u ON u.id=c.author_id LEFT JOIN public_acceptances accepted ON accepted.question_id=c.id`;
}
export function contentDto(row: PublicRow) {
    return {
        id: row.id, kind: row.kind, courseId: row.course_id,
        author: { id: row.author_id, nickname: row.author_name, isDeleted: Boolean(row.author_deleted),
            isTeacher: row.author_role === 'teacher', isCourseTeacher: Boolean(row.course_teacher) },
        title: row.title, body: parseBody(row.body), format: 'prosemirror', tags: row.tags === null ? null : JSON.parse(row.tags) as string[],
        targetKind: row.target_kind, targetId: row.target_id,
        revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
        score: Number(row.score), myVote: Number(row.my_vote),
        ...(row.kind === 'question' ? { acceptedAnswerId: row.acceptedAnswerId, solved: row.acceptedAnswerId !== null } : {}),
    };
}
export async function publicDetail(c: Ctx, id: string) {
    const row = await createDatabase(c.env.DB).get<PublicRow>(sql`${publicSelect(c)} WHERE c.id=${id}`);
    if (!row) throw new HttpError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
    return contentDto(row);
}