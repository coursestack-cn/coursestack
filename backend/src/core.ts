import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

export type Actor = { id: string; display_name: string; role: 'student' | 'teacher' | 'admin' };
export type AppEnv = {
  Bindings: { DB: D1Database; FILES: R2Bucket; APP_ENV: 'local' | 'dev' | 'production'; ALLOWED_ORIGIN?: string; INTERNAL_API_TOKEN?: string };
  Variables: { actor: Actor | null; requestId: string };
};
export type Ctx = Context<AppEnv>;
export type ContentRow = {
  id: string; kind: 'question' | 'answer' | 'comment'; course_id: string; author_id: string;
  title: string | null; body: string; tags: string; question_id: string | null;
  target_kind: string | null; target_id: string | null; reply_to_id: string | null;
  file_version_id: string | null; status: string; revision: number; created_at: string; updated_at: string;
  accepted_answer_id: string | null; accepted_by: string | null; accepted_at: string | null;
  accepted_semester_id: string | null; acceptance_id: string | null; award_cents: number; award_eligible: number;
  request_hash: string;
};
export type PublicRow = ContentRow & { author_name: string; author_role: string; course_teacher: number; score: number; my_vote: number };
export class ApiError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 500 | 503, public code: string, message: string) { super(message); }
}
export const db = (c: Ctx) => drizzle(c.env.DB);
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
export const actor = (c: Ctx): Actor => {
  const a = c.get('actor');
  if (!a) throw new ApiError(401, 'UNAUTHENTICATED', '请先登录');
  return a;
};
export const idSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const bodySchema = z.string().trim().min(1).max(30000);
export const revisionSchema = z.number().int().positive();
export const pointsSchema = z.number().min(0).max(100).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, '最多两位小数');
export const tagsSchema = z.array(z.string().trim().min(1).max(30)).max(8).transform(v => [...new Set(v)]);
export async function input<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.output<T>> {
  if (!(c.req.header('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'JSON_REQUIRED', '请求正文必须是 application/json');
  }
  let value: unknown;
  try { value = await c.req.json(); } catch { throw new ApiError(400, 'INVALID_JSON', 'JSON 格式不正确'); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; '));
  return parsed.data;
}
export function page(c: Ctx) {
  const data = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(c.req.query());
  if (!data.success) throw new ApiError(400, 'INVALID_PAGINATION', 'page 需为 1–10000，pageSize 需为 1–50 的整数');
  return { ...data.data, offset: (data.data.page - 1) * data.data.pageSize };
}
export function listResult<T>(items: T[], p: ReturnType<typeof page>) {
  return { items: items.slice(0, p.pageSize), page: p.page, pageSize: p.pageSize, hasMore: items.length > p.pageSize };
}
export function parsedEnum<T extends readonly string[]>(value: string | undefined, values: T, fallback?: T[number]): T[number] | undefined {
  if (value === undefined) return fallback;
  if (!values.includes(value)) throw new ApiError(400, 'INVALID_FILTER', `允许值: ${values.join(', ')}`);
  return value;
}
export function activeUser(a: Actor): SQL {
  return sql`EXISTS(SELECT 1 FROM users actor WHERE actor.id=${a.id} AND actor.active=1)`;
}
export function management(a: Actor, course: SQL): SQL {
  return sql`EXISTS(SELECT 1 FROM users manager WHERE manager.id=${a.id} AND manager.active=1 AND (
    manager.role='admin' OR (manager.role='teacher' AND EXISTS(SELECT 1 FROM course_teachers ct
      JOIN semesters sem ON sem.id=ct.semester_id AND sem.status='active'
      WHERE ct.user_id=manager.id AND ct.course_id=${course}))))`;
}
export function editPermission(a: Actor, course: SQL, author: SQL): SQL {
  return sql`((${author}=${a.id} AND ${activeUser(a)}) OR ${management(a, course)})`;
}
export async function requireManagement(c: Ctx, courseId: string) {
  const a = actor(c);
  const allowed = await db(c).get(sql`SELECT 1 WHERE ${management(a, sql`${courseId}`)}`);
  if (!allowed) throw new ApiError(403, 'COURSE_PERMISSION_DENIED', '需要本学期课程教师或管理员权限');
  return a;
}
export async function rawContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
  const row = await db(c).get<ContentRow>(sql`SELECT * FROM contents WHERE id=${id}`);
  if (!row || (kind && row.kind !== kind)) throw new ApiError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
  return row;
}
export async function visibleContent(c: Ctx, id: string, kind?: ContentRow['kind']) {
  const row = await db(c).get<ContentRow>(sql`SELECT * FROM public_contents WHERE id=${id}`);
  if (!row || (kind && row.kind !== kind)) throw new ApiError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
  return row;
}
export async function requireEditor(c: Ctx, row: ContentRow) {
  const a = actor(c);
  const allowed = await db(c).get(sql`SELECT 1 WHERE ${editPermission(a, sql`${row.course_id}`, sql`${row.author_id}`)}`);
  if (!allowed) throw new ApiError(403, 'CONTENT_PERMISSION_DENIED', '只能维护自己的内容或所管理课程的内容');
  return a;
}
export function assertChanged(result: { meta: { changes: number } }) {
  if (result.meta.changes === 0) throw new ApiError(409, 'STATE_CONFLICT', '内容已改变，请刷新后重试');
}
export async function requestIdentity(c: Ctx, value: unknown) {
  const key = c.req.header('Idempotency-Key');
  if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '发布请求需携带 8–100 位字母、数字、下划线或短横线的 Idempotency-Key');
  }
  return { key, fingerprint: await hash(`${c.req.method}:${new URL(c.req.url).pathname}:${JSON.stringify(value)}`) };
}
export function publicSelect(c: Ctx) {
  const viewerId = c.get('actor')?.id ?? '';
  return sql`SELECT c.*,u.display_name AS author_name,u.role AS author_role,
    EXISTS(SELECT 1 FROM course_teachers ct JOIN semesters s ON s.id=ct.semester_id AND s.status='active'
      WHERE ct.user_id=c.author_id AND ct.course_id=c.course_id AND u.role='teacher') AS course_teacher,
    COALESCE((SELECT SUM(v.value) FROM votes v WHERE v.content_id=c.id),0) AS score,
    COALESCE((SELECT value FROM votes v WHERE v.content_id=c.id AND v.user_id=${viewerId}),0) AS my_vote
    FROM public_contents c JOIN users u ON u.id=c.author_id`;
}
export function contentDto(row: PublicRow) {
  return {
    id: row.id, kind: row.kind, courseId: row.course_id,
    author: { id: row.author_id, displayName: row.author_name, isTeacher: row.author_role === 'teacher', isCourseTeacher: Boolean(row.course_teacher) },
    title: row.title, body: row.body, format: 'markdown', tags: JSON.parse(row.tags) as string[],
    questionId: row.question_id, targetKind: row.target_kind, targetId: row.target_id, replyToId: row.reply_to_id,
    fileVersionId: row.file_version_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    score: Number(row.score), myVote: Number(row.my_vote),
    ...(row.kind === 'question' ? { acceptedAnswerId: row.accepted_answer_id, solved: row.accepted_answer_id !== null } : {}),
  };
}
export async function publicDetail(c: Ctx, id: string) {
  const row = await db(c).get<PublicRow>(sql`${publicSelect(c)} WHERE c.id=${id}`);
  if (!row) throw new ApiError(404, 'CONTENT_UNAVAILABLE', '内容不存在或不可用');
  return contentDto(row);
}