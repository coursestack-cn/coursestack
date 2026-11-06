import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { toPlainText, validateDoc } from '../../../shared/rich-text/index.ts';
import { createDatabase } from '../db/index.ts';
import { HttpError, listResult, page, parsedEnum, queryPage, respond } from '../http.ts';
import { contentDto, publicSelect } from '../discussions/service.ts';
import { parseBody } from '../discussions/body.ts';
import type { AppEnv, Ctx, PublicRow } from '../discussions/types.ts';
import { withMaterialVersions } from '../materials/service.ts';

async function teacher(c: Ctx) {
    const row = await createDatabase(c.env.DB).get<{ id: string; nickname: string | null; avatar_key: string | null }>(sql`
        SELECT id,nickname,avatar_key FROM accounts WHERE id=${c.req.param('id')} AND role='teacher' AND status='active'`);
    if (!row) throw new HttpError(404, 'TEACHER_NOT_FOUND', '教师主页不存在');
    return { id: row.id, nickname: row.nickname, isTeacher: true, isDeleted: false,
        avatarUrl: row.avatar_key ? `/api/profiles/${encodeURIComponent(row.id)}/avatar` : null };
}

type CourseRow = { id: string; name: string; introduction: string };
type ContextRow = {
    id: string; course_name: string; root_id: string; root_kind: 'question' | 'material'; root_title: string;
    quote_kind: 'answer' | 'comment' | null; quote_id: string | null; quote_body: string | null;
    quote_name: string | null; quote_author_deleted: number | null; is_accepted: number;
};

export const teacherRoutes = new Hono<AppEnv>();
teacherRoutes.get('/teachers/:id', async c => respond(c, await teacher(c)));

teacherRoutes.get('/teachers/:id/counts', async c => {
    const { id } = await teacher(c);
    const counts = await createDatabase(c.env.DB).get(sql`SELECT
        (SELECT COUNT(DISTINCT course_id) FROM teaching_classes WHERE teacher_id=${id}) AS courses,
        COUNT(CASE WHEN kind='material' THEN 1 END) AS materials,
        COUNT(CASE WHEN kind='question' THEN 1 END) AS questions,
        COUNT(CASE WHEN kind='answer' THEN 1 END) AS answers,
        COUNT(CASE WHEN kind='comment' THEN 1 END) AS comments
        FROM public_contents WHERE author_id=${id}`);
    return respond(c, counts);
});

teacherRoutes.get('/teachers/:id/activity', async c => {
    const { id } = await teacher(c), p = page(c);
    const kind = parsedEnum(c.req.query('kind'), ['course', 'material', 'question', 'answer', 'comment'] as const, 'course')!;
    const db = createDatabase(c.env.DB);
    if (kind === 'course') {
        const { rows, total } = await queryPage<CourseRow>(c, p, sql`SELECT course.id,course.name,course.introduction
            FROM courses course JOIN teaching_classes tc ON tc.course_id=course.id JOIN terms t ON t.id=tc.term_id
            WHERE tc.teacher_id=${id} GROUP BY course.id ORDER BY MAX(t.current) DESC,course.id ASC`);
        const terms = rows.length ? await db.all<{ course_id: string; id: string; name: string; current: number }>(sql`
            SELECT tc.course_id,t.id,t.name,t.current FROM teaching_classes tc JOIN terms t ON t.id=tc.term_id
            WHERE tc.teacher_id=${id} AND tc.course_id IN (${sql.join(rows.map(row => sql`${row.id}`), sql`,`)})
            ORDER BY t.current DESC,t.id DESC`) : [];
        return respond(c, { kind, ...listResult(rows.map(row => ({ kind: 'course' as const, ...row,
            terms: terms.filter(term => term.course_id === row.id).map(term => ({ id: term.id, name: term.name, current: Boolean(term.current) })) })), p, total) });
    }
    const { rows, total } = await queryPage<PublicRow>(c, p, sql`${publicSelect(c)}
        WHERE c.author_id=${id} AND c.kind=${kind} AND u.role='teacher' AND u.status='active'
        ORDER BY c.created_at DESC,c.id ASC`);
    // Read context in one batch. Only public_contents may supply quoted text, including for the owner or a manager.
    const context = rows.length ? await db.all<ContextRow>(sql`SELECT c.id,course.name AS course_name,
        root.id AS root_id,root.kind AS root_kind,root.title AS root_title,
        CASE WHEN c.kind='comment' THEN CASE WHEN c.reply_to_id IS NOT NULL THEN 'comment' WHEN target.kind='answer' THEN 'answer' END END AS quote_kind,
        quote.id AS quote_id,quote.body AS quote_body,
        CASE WHEN author.status='deleted' THEN '已删除' ELSE author.nickname END AS quote_name,author.status='deleted' AS quote_author_deleted,
        EXISTS(SELECT 1 FROM public_acceptances accepted WHERE accepted.answer_id=c.id) AS is_accepted
        FROM public_contents c JOIN courses course ON course.id=c.course_id
        LEFT JOIN contents target ON target.id=c.target_id
        JOIN public_contents root ON root.id=CASE WHEN c.kind IN ('question','material') THEN c.id WHEN target.kind='answer' THEN target.target_id ELSE c.target_id END
        LEFT JOIN public_contents quote ON c.kind='comment' AND quote.id=COALESCE(c.reply_to_id,c.target_id)
        LEFT JOIN accounts author ON author.id=quote.author_id
        WHERE c.id IN (${sql.join(rows.map(row => sql`${row.id}`), sql`,`)})`) : [];
    const contexts = new Map(context.map(row => [row.id, row]));
    const items = await withMaterialVersions(c, rows.map(contentDto));
    return respond(c, { kind, ...listResult(items.flatMap(item => {
        const detail = contexts.get(item.id);
        if (!detail) return []; // A branch may have become unavailable after the page query.
        const quoteDoc = validateDoc(parseBody(detail.quote_body));
        return [{ ...item, courseName: detail.course_name,
            root: { id: detail.root_id, kind: detail.root_kind, title: detail.root_title },
            quote: detail.quote_kind ? { kind: detail.quote_kind, available: detail.quote_id !== null,
                author: detail.quote_id ? { nickname: detail.quote_name, isDeleted: Boolean(detail.quote_author_deleted) } : null,
                excerpt: detail.quote_id && quoteDoc.ok ? toPlainText(quoteDoc.doc, { maxChars: 160 }) : null } : null,
            ...(item.kind === 'answer' ? { isAccepted: Boolean(detail.is_accepted) } : {}) }];
    }), p, total) });
});