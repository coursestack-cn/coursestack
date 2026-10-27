import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { createDatabase } from './db/index.ts';
import { digest } from './auth/crypto.ts';
import type { Ctx } from './discussions/types.ts';

export class HttpError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function readJson(request: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        throw new HttpError(415, 'JSON_REQUIRED', '请求必须使用 JSON');
    }
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'INVALID_INPUT', '请求体不能为空');
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
            await reader.cancel();
            throw new HttpError(413, 'BODY_TOO_LARGE', '请求体过大');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try {
        const body = JSON.parse(new TextDecoder().decode(bytes));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        return body;
    } catch {
        throw new HttpError(400, 'INVALID_INPUT', '请求体必须是有效 JSON 对象');
    }
}

export function requireSameOrigin(request: Request) {
    if (request.headers.get('origin') !== new URL(request.url).origin) {
        throw new HttpError(403, 'ORIGIN_DENIED', '请求来源不被允许');
    }
}

export function stringField(body: Record<string, unknown>, name: string, max = 80): string {
    const value = body[name];
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new HttpError(400, 'INVALID_INPUT', `${name} 格式不正确`);
    }
    return value.trim();
}

export const idSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const revisionSchema = z.number().int().positive();
export const pointsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const tagsSchema = z.array(z.string().trim().min(1).max(30)).max(8).transform(v => [...new Set(v)]);
export async function input<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.output<T>> {
    const value = await readJson(c.req.raw, 128 * 1024);
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', parsed.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; '));
    return parsed.data;
}
export function page(c: Ctx) {
    const data = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(c.req.query());
    if (!data.success) throw new HttpError(400, 'INVALID_PAGINATION', 'page 需为 1–10000，pageSize 需为 1–50 的整数');
    return { ...data.data, offset: (data.data.page - 1) * data.data.pageSize };
}
export function listResult<T>(items: T[], p: ReturnType<typeof page>, total: number) {
    return { items, page: p.page, pageSize: p.pageSize, total };
}
export function respond<T>(c: Ctx, data: T, status: 200 | 201 = 200) {
    return c.json({ data }, status);
}
export function parsedEnum<T extends readonly string[]>(value: string | undefined, values: T, fallback?: T[number]): T[number] | undefined {
    if (value === undefined) return fallback;
    if (!values.includes(value)) throw new HttpError(400, 'INVALID_FILTER', `允许值: ${values.join(', ')}`);
    return value;
}
export function assertChanged(result: { meta: { changes: number } }) {
    if (result.meta.changes === 0) throw new HttpError(409, 'STATE_CONFLICT', '内容已改变，请刷新后重试');
}
export async function requestIdentity(c: Ctx, value: unknown) {
    const key = c.req.header('Idempotency-Key');
    if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', '发布请求需携带 8–100 位字母、数字、下划线或短横线的 Idempotency-Key');
    }
    return { key, fingerprint: await digest(`${c.req.method}:${new URL(c.req.url).pathname}:${JSON.stringify(value)}`) };
}

export async function queryPage<T>(c: Ctx, p: ReturnType<typeof page>, query: SQL) {
    const total = await createDatabase(c.env.DB).get<{ total: number }>(sql`SELECT COUNT(*) AS total FROM (${query})`);
    const rows = await createDatabase(c.env.DB).all<T>(sql`${query} LIMIT ${p.pageSize} OFFSET ${p.offset}`);
    return { rows, total: total?.total ?? 0 };
}