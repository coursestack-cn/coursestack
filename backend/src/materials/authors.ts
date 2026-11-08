import { sql } from 'drizzle-orm';
import type { Ctx } from '../discussions/types.ts';
import { HttpError, idSchema, listResult, page, queryPage, respond } from '../http.ts';
import { courseIdentity } from './service.ts';

export function contentAuthorId(c: Ctx) {
    const value = c.req.query('authorId');
    if (value === undefined) return undefined;
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, 'INVALID_FILTER', '发布人筛选无效');
    return parsed.data;
}

type AuthorRow = {
    id: string; nickname: string | null; avatar_key: string | null;
    is_deleted: number; is_teacher: number; course_teacher: number; short_id: string | null;
};

export async function courseAuthors(c: Ctx) {
    const courseId = await courseIdentity(c, c.req.param('id')!), p = page(c), authorId = contentAuthorId(c);
    const q = c.req.query('q')?.trim();
    if (q && Array.from(q).length > 80) throw new HttpError(400, 'INVALID_FILTER', '发布人昵称关键词最长80字');
    // Candidates and duplicate names are determined across the course, before search and pagination.
    const { rows, total } = await queryPage<AuthorRow>(c, p, sql`WITH authors AS (
        SELECT u.id,CASE WHEN u.status='deleted' THEN '已删除' ELSE u.nickname END AS nickname,
            CASE WHEN u.status='deleted' THEN '已删除' ELSE COALESCE(NULLIF(trim(u.nickname),''),'未设置昵称') END AS display_name,
            CASE WHEN u.status='active' THEN u.avatar_key ELSE NULL END AS avatar_key,
            u.status='deleted' AS is_deleted,u.status<>'deleted' AND u.role='teacher' AS is_teacher,
            EXISTS(SELECT 1 FROM teaching_classes tc JOIN terms t ON t.id=tc.term_id AND t.current=1
                WHERE tc.course_id=${courseId} AND tc.teacher_id=u.id AND u.role='teacher' AND u.status='active') AS course_teacher,
            MAX(c.created_at) AS latest_publication
        FROM public_contents c JOIN accounts u ON u.id=c.author_id
        WHERE c.course_id=${courseId} AND c.kind IN ('question','material') GROUP BY u.id
    ) SELECT a.*,
        CASE WHEN a.is_deleted OR a.display_name='未设置昵称' OR EXISTS(
            SELECT 1 FROM authors other WHERE other.id<>a.id AND other.display_name=a.display_name
        ) THEN CASE WHEN EXISTS(SELECT 1 FROM authors other WHERE other.id<>a.id
            AND other.display_name=a.display_name AND substr(other.id,1,8)=substr(a.id,1,8))
            THEN a.id ELSE substr(a.id,1,8) END ELSE NULL END AS short_id
        FROM authors a WHERE 1=1
        ${authorId === undefined ? sql`` : sql`AND a.id=${authorId}`}
        ${q ? sql`AND instr(lower(a.display_name),lower(${q}))>0` : sql``}
        ORDER BY a.latest_publication DESC,a.id ASC`);
    return respond(c, listResult(rows.map(row => ({ id: row.id, nickname: row.nickname,
        avatarUrl: row.avatar_key ? `/api/profiles/${encodeURIComponent(row.id)}/avatar` : null,
        isDeleted: Boolean(row.is_deleted), isTeacher: Boolean(row.is_teacher), isCourseTeacher: Boolean(row.course_teacher),
        shortId: row.short_id })), p, total));
}