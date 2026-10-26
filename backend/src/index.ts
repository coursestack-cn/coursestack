import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import { authenticate } from './auth';
import { ApiError, uid, type AppEnv } from './core';
import { courseRoutes } from './routes/courses';
import { discussionRoutes } from './routes/discussion';
import { acceptanceRoutes } from './routes/acceptance';
import { moderationRoutes } from './routes/moderation';
import { internalRoutes, personalRoutes } from './routes/integration';
import { openapi } from './openapi';
import { db } from './core';
import { sql } from 'drizzle-orm';
import { isLocalRequest, localRoutes } from './routes/local';
import { localDemoPage } from './local-demo';

export const app = new Hono<AppEnv>();
app.use('*', async (c, next) => {
  c.set('requestId', uid()); c.header('X-Request-Id', c.get('requestId'));
  c.header('Cache-Control', 'no-store'); await next();
});
app.use('*', secureHeaders());
app.use('*', bodyLimit({ maxSize: 128 * 1024, onError: () => { throw new ApiError(413, 'BODY_TOO_LARGE', '请求正文超过128 KiB'); } }));
app.use('/api/*', cors({
  origin: (origin, c) => origin === c.env.ALLOWED_ORIGIN || origin === new URL(c.req.url).origin ? origin : '',
  credentials: true, allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'], exposeHeaders: ['X-Request-Id', 'Idempotency-Replayed', 'Location'],
}));
app.get('/', c => isLocalRequest(c) ? c.html(localDemoPage)
  : c.text('CourseStack 组员3后端\n接口: /api\n健康检查: /api/health\n接口规范: /api/openapi.json\n启动与联调说明见 backend/README.md\n'));
app.get('/api/health', async c => {
  try { await db(c).get(sql`SELECT id FROM courses LIMIT 1`); }
  catch { throw new ApiError(503, 'DATABASE_NOT_READY', '数据库尚未初始化或暂不可用'); }
  return c.json({ ok: true, service: 'coursestack-member3', environment: c.env.APP_ENV, checks: { worker: 'ok', d1: 'ok' } });
});
app.get('/openapi.json', c => c.json(openapi));
app.get('/api/openapi.json', c => c.json(openapi));
app.route('/api/local', localRoutes);
const api = new Hono<AppEnv>();
api.use('*', authenticate);
api.route('/', courseRoutes);
api.route('/', discussionRoutes);
api.route('/', acceptanceRoutes);
api.route('/', moderationRoutes);
api.route('/', personalRoutes);
app.route('/api', api);
app.route('/internal', internalRoutes);
app.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: '接口不存在', requestId: c.get('requestId') } }, 404));
app.onError((error, c) => {
  let apiError: ApiError;
  const causes: string[] = [];
  for (let e: unknown = error, i = 0; e instanceof Error && i < 5; i++, e = e.cause) causes.push(e.message);
  const message = causes.join(' ');
  if (error instanceof ApiError) apiError = error;
  else if (error instanceof HTTPException) apiError = new ApiError(error.status as 400, 'HTTP_ERROR', error.message);
  else if (/invalid_(answer_parent|comment_target|reply|file_version|acceptance)/.test(message)) {
    apiError = new ApiError(409, 'INVALID_TARGET', '关联对象不可用、跨课程或状态已改变');
  } else if (/UNIQUE constraint failed/.test(message)) apiError = new ApiError(409, 'DUPLICATE_RECORD', '数据已存在，请检查编号或刷新后重试');
  else if (/FOREIGN KEY constraint failed/.test(message)) apiError = new ApiError(409, 'REFERENCE_CONFLICT', '关联数据已改变');
  else {
    console.error(JSON.stringify({ requestId: c.get('requestId'), code: 'UNHANDLED_ERROR', errorType: error.name }));
    apiError = new ApiError(500, 'INTERNAL_ERROR', '服务暂时无法处理请求');
  }
  return c.json({ error: { code: apiError.code, message: apiError.message, requestId: c.get('requestId') } }, apiError.status);
});
export default { fetch: app.fetch };