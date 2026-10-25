import { sql } from 'drizzle-orm';
import { createDatabase } from './db/index.ts';
import type { Env } from './env.ts';
import { authRoutes } from './auth/routes.ts';
import { HttpError, json } from './http.ts';
import { accountRoutes } from './accounts/routes.ts';
import { emailRoutes } from './auth/email.ts';
import { avatarRoutes } from './accounts/avatar.ts';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            const response = await accountRoutes(request, env)
                ?? await emailRoutes(request, env)
                ?? await avatarRoutes(request, env)
                ?? await authRoutes(request, env);
            if (response) return response;
        } catch (error) {
            if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
            return json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } }, 500);
        }
        if (new URL(request.url).pathname !== '/api/health') {
            return json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404);
        }
        if (request.method !== 'GET') {
            return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } }, 405, { Allow: 'GET' });
        }
        try {
            await createDatabase(env.DB).get(sql`SELECT 1`);
            return json({ data: { status: 'ok', environment: env.APP_ENV, database: 'ok' } });
        } catch {
            return json({ error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂时不可用' } }, 503);
        }
    },
};