import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDatabase } from './db/index.ts';
import type { AppEnv } from './discussions/types.ts';
import { authRoutes } from './auth/routes.ts';
import { HttpError, json } from './http.ts';
import { accountRoutes } from './accounts/routes.ts';
import { avatarRoutes } from './accounts/avatar.ts';
import { authenticate } from './auth/middleware.ts';
import { courseRoutes } from './courses/routes.ts';
import { discussionRoutes } from './discussions/routes.ts';
import { acceptanceRoutes } from './discussions/acceptance.ts';
import { moderationRoutes } from './moderation/routes.ts';
import { internalRoutes, personalRoutes } from './integration/routes.ts';
import { openapi } from './openapi.ts';

export const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.set('requestId', crypto.randomUUID());
    c.header('X-Request-Id', c.get('requestId'));
    const waitUntil = (work: Promise<unknown>) => {
        try { c.executionCtx.waitUntil(work); } catch { /* Direct test calls have no execution context. */ }
    };
    const response = await accountRoutes(c.req.raw, c.env, waitUntil)
        ?? await avatarRoutes(c.req.raw, c.env, waitUntil)
        ?? await authRoutes(c.req.raw, c.env);
    if (response) {
        response.headers.set('X-Request-Id', c.get('requestId'));
        return response;
    }
    await next();
    c.header('X-Request-Id', c.get('requestId'));
});

app.all('/api/health', async (c) => {
    if (c.req.raw.method !== 'GET') {
        return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } }, 405, { Allow: 'GET' });
    }
    try {
        await createDatabase(c.env.DB).get(sql`SELECT 1`);
        return json({ data: { status: 'ok', environment: c.env.APP_ENV, database: 'ok' } });
    } catch {
        return json({ error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂时不可用' } }, 503);
    }
});

app.route('/api/internal', internalRoutes);
app.get('/api/openapi.json', c => c.json(openapi));
const api = new Hono<AppEnv>();
api.use('*', authenticate);
api.route('/', courseRoutes);
api.route('/', discussionRoutes);
api.route('/', acceptanceRoutes);
api.route('/', moderationRoutes);
api.route('/', personalRoutes);
app.route('/api', api);

app.notFound(() => json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404));
app.onError((error, c) => {
    const failure = (status: number, code: string, message: string) =>
        json({ error: { code, message } }, status, { 'X-Request-Id': c.get('requestId') });
    if (error instanceof HttpError) return failure(error.status, error.code, error.message);
    const causes: string[] = [];
    for (let cause: unknown = error, depth = 0; cause instanceof Error && depth < 5; depth++, cause = cause.cause) {
        causes.push(cause.message);
    }
    const detail = causes.join(' ');
    if (/invalid_(answer_parent|comment_target|content_target|reply|file_version|acceptance|enrollment_identity)/.test(detail)) {
        return failure(409, 'INVALID_TARGET', '关联对象不可用、跨课程或状态已改变');
    }
    if (/course_requires_teacher|enrollment_teacher_required|enrollment_teacher_unique|current_term_required|enrollment_instance_immutable/.test(detail)) return failure(409, 'COURSE_MEMBERSHIP_CONFLICT', '课程必须有且只有一位教师，且新课程实例只能建立在当前学期');
    if (/UNIQUE constraint failed/.test(detail)) return failure(409, 'DUPLICATE_RECORD', '数据已存在，请检查编号或刷新后重试');
    if (/FOREIGN KEY constraint failed/.test(detail)) return failure(409, 'REFERENCE_CONFLICT', '关联数据已改变');
    return failure(500, 'INTERNAL_ERROR', '服务暂时不可用');
});

export default { fetch: app.fetch };