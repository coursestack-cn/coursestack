import { Hono } from 'hono';
import { sql, type SQL } from 'drizzle-orm';
import { highlightRanges, parseSearchQuery, searchExcerpt } from '../../../shared/search.ts';
import { HttpError, listResult, page, parsedEnum, respond } from '../http.ts';
import { createDatabase } from '../db/index.ts';
import { courseIdSchema } from '../courses/validation.ts';
import type { AppEnv } from '../discussions/types.ts';

type SearchRow = {
    id: string; kind: 'course' | 'material' | 'question' | 'answer'; title: string; body_text: string;
    tags: string | null; course_id: string; course_name: string; question_id: string | null; updated_at: number;
    author_id: string | null; author_name: string | null; author_role: string | null; author_deleted: number;
    author_avatar: string | null;
};
const contains = (field: SQL, term: string) => sql`instr(lower(COALESCE(${field},'')),${term})>0`;
const tagged = (field: SQL, term: string) => sql`EXISTS(SELECT 1 FROM json_each(${field}) WHERE ${contains(sql`value`, term)})`;

// Answers use the question title and tags for context/filtering only, never keyword recall.
// public_contents already verifies every ancestor, so the parent join needs no second recursive visibility scan.
const candidates = sql`SELECT c.id,'course' AS kind,c.name AS title,c.name AS match_title,c.id AS code,
    c.introduction AS body_text,NULL AS tags,NULL AS match_tags,c.id AS course_id,c.name AS course_name,
    NULL AS question_id,c.updated_at,NULL AS author_id,NULL AS author_name,NULL AS author_role,
    0 AS author_deleted,NULL AS author_avatar FROM courses c
    UNION ALL
    SELECT c.id,c.kind,CASE WHEN c.kind='answer' THEN q.title ELSE c.title END,
    CASE WHEN c.kind='answer' THEN '' ELSE c.title END,'' AS code,c.body_text,
    CASE WHEN c.kind='answer' THEN q.tags ELSE c.tags END,
    CASE WHEN c.kind='answer' THEN NULL ELSE c.tags END,c.course_id,course.name,
    CASE WHEN c.kind='answer' THEN q.id ELSE NULL END,c.updated_at,
    a.id,CASE WHEN a.status='deleted' THEN '已删除' ELSE a.nickname END,
    CASE WHEN a.status='active' THEN a.role ELSE NULL END,a.status='deleted',
    CASE WHEN a.status='active' THEN a.avatar_key ELSE NULL END
    FROM public_contents c JOIN courses course ON course.id=c.course_id JOIN accounts a ON a.id=c.author_id
    LEFT JOIN contents q ON c.kind='answer' AND q.id=c.target_id AND q.kind='question'
    WHERE c.kind IN ('material','question','answer') AND (c.kind<>'answer' OR q.id IS NOT NULL)`;

export const searchRoutes = new Hono<AppEnv>();
searchRoutes.get('/search', async c => {
    const parsed = parseSearchQuery(c.req.query('q') ?? ''), p = page(c);
    if (parsed.error) throw new HttpError(400, 'INVALID_SEARCH_QUERY', parsed.error);
    const type = parsedEnum(c.req.query('type'), ['all', 'course', 'material', 'question', 'answer'] as const, 'all');
    const sort = parsedEnum(c.req.query('sort'), ['relevance', 'updated'] as const, 'relevance');
    const course = c.req.query('course')?.trim(), tag = c.req.query('tag')?.trim();
    if (course !== undefined && !courseIdSchema.safeParse(course).success) throw new HttpError(400, 'INVALID_FILTER', '课程号格式无效');
    if (tag && (Array.from(tag).length > 30 || type === 'course')) throw new HttpError(400, 'INVALID_FILTER', '标签最多30个字符，课程结果不支持标签筛选');
    if (!parsed.q) return respond(c, { ...listResult([], p, 0), q: '', type, sort });
    const conditions = parsed.terms.map(term => sql`(${contains(sql`s.code`, term)} OR ${contains(sql`s.match_title`, term)}
        OR ${tagged(sql`s.match_tags`, term)} OR ${contains(sql`s.body_text`, term)})`);
    if (type !== 'all') conditions.push(sql`s.kind=${type}`);
    if (course) conditions.push(sql`s.course_id=${course}`);
    if (tag) conditions.push(tagged(sql`s.tags`, tag.replace(/[A-Z]/g, value => value.toLowerCase())));
    const score = sql.join(parsed.terms.map(term => sql`CASE WHEN ${contains(sql`s.code`, term)} OR ${contains(sql`s.match_title`, term)}
        THEN 100 WHEN ${tagged(sql`s.match_tags`, term)} THEN 10 ELSE 1 END`), sql` + `);
    const exact = parsed.q.replace(/[A-Z]/g, value => value.toLowerCase());
    const database = createDatabase(c.env.DB);
    const filtered = sql`SELECT s.* FROM (${candidates}) s WHERE ${sql.join(conditions, sql` AND `)}`;
    // Counting does not need ranking or a sort of full body text.
    const count = await database.get<{ total: number }>(sql`SELECT COUNT(*) AS total FROM (${filtered})`);
    const rows = await database.all<SearchRow>(sql`${filtered}
        ORDER BY ${sort === 'relevance' ? sql`(lower(s.code)=${exact} OR lower(s.match_title)=${exact}) DESC,(${score}) DESC,` : sql``}
        s.updated_at DESC,s.kind ASC,s.id ASC LIMIT ${p.pageSize} OFFSET ${p.offset}`);
    const total = count?.total ?? 0;
    return respond(c, { ...listResult(rows.map(row => {
        const excerpt = searchExcerpt(row.body_text, parsed.terms);
        return { id: row.id, kind: row.kind, title: row.title, excerpt, tags: row.tags ? JSON.parse(row.tags) as string[] : [],
            course: { id: row.course_id, name: row.course_name }, questionId: row.question_id, updatedAt: row.updated_at,
            author: row.author_id === null ? null : { id: row.author_deleted ? null : row.author_id, nickname: row.author_name,
                isTeacher: row.author_role === 'teacher', isDeleted: Boolean(row.author_deleted),
                avatarUrl: row.author_avatar ? `/api/profiles/${encodeURIComponent(row.author_id)}/avatar` : null },
            highlights: { title: highlightRanges(row.title, row.kind === 'answer' ? [] : parsed.terms),
                excerpt: highlightRanges(excerpt, parsed.terms) } };
    }), p, total), q: parsed.q, type, sort });
});