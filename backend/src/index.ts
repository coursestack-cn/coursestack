import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDatabase } from './db/index.ts';
import type { AppEnv } from './discussions/types.ts';
import { authRoutes } from './auth/routes.ts';
import { HttpError, json } from './http.ts';
import { accountRoutes } from './accounts/routes.ts';
import { accountImportRoutes } from './accounts/imports.ts';
import { avatarRoutes } from './accounts/avatar.ts';
import { authenticate } from './auth/middleware.ts';
import { searchRoutes } from './search/routes.ts';
import { courseRoutes } from './courses/routes.ts';
import { classRoutes } from './courses/classes.ts';
import { teacherRoutes } from './teachers/routes.ts';
import { discussionRoutes } from './discussions/routes.ts';
import { acceptanceRoutes } from './discussions/acceptance.ts';
import { bonusRoutes } from './discussions/bonus.ts';
import { moderationRoutes } from './moderation/routes.ts';
import { internalRoutes, personalRoutes } from './integration/routes.ts';
import { favoriteRoutes } from './favorites/routes.ts';
import { notificationRoutes } from './notifications/routes.ts';
import { openapi } from './openapi.ts';
import { materialRoutes } from './materials/routes.ts';
import { materialUploadRoutes } from './materials/uploads.ts';
import { cleanupMaterialUploads } from './materials/cleanup.ts';
import { type Env } from './env.ts';

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
api.route('/', accountImportRoutes);
api.route('/', courseRoutes);
api.route('/', searchRoutes);
api.route('/', classRoutes);
api.route('/', teacherRoutes);
api.route('/', discussionRoutes);
api.route('/', acceptanceRoutes);
api.route('/', bonusRoutes);
api.route('/', moderationRoutes);
api.route('/', personalRoutes);
api.route('/', notificationRoutes);
api.route('/', favoriteRoutes);
api.route('/', materialRoutes);
api.route('/', materialUploadRoutes);
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
    if (/material_last_version/.test(detail)) return failure(409, 'MATERIAL_LAST_VERSION', '资料至少保留一个版本；如需移除最后一个版本，请删除整份资料');
    if (/deleted_content/.test(detail)) return failure(409, 'DELETED_CONTENT', '已删除内容不能恢复');
    if (/invalid_(content_target|comment_reply|acceptance|enrollment_identity)/.test(detail)) {
        return failure(409, 'INVALID_TARGET', '关联对象不可用、跨课程或状态已改变');
    }
    if (/invalid_(class_teacher|class_student|bonus_class)|course_admin_required|current_term_required|course_identity_immutable|course_term_identity_immutable|teaching_class_identity_immutable|class_student_identity_immutable/.test(detail)) return failure(409, 'COURSE_MEMBERSHIP_CONFLICT', '课程、学期或教学班关系已变化');
    if (/UNIQUE constraint failed/.test(detail)) return failure(409, 'DUPLICATE_RECORD', '数据已存在，请检查编号或刷新后重试');
    if (/FOREIGN KEY constraint failed/.test(detail)) return failure(409, 'REFERENCE_CONFLICT', '关联数据已改变');
    return failure(500, 'INTERNAL_ERROR', '服务暂时不可用');
});

export default {
    fetch: app.fetch,
    scheduled(_event: ScheduledController, env: Env, context: ExecutionContext) {
        context.waitUntil(cleanupMaterialUploads(env));
    },
};