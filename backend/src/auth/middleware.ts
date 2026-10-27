import type { MiddlewareHandler } from 'hono';
import { readSession } from './service.ts';
import { digest } from './crypto.ts';
import { HttpError, requireSameOrigin } from '../http.ts';
import type { Actor, AppEnv, Ctx } from '../discussions/types.ts';

export function actor(c: Ctx): Actor {
    const current = c.get('actor');
    if (!current) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录');
    return current;
}

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('actor', null);
    const session = await readSession(c.env.DB, c.req.raw);
    if (session?.mustChangePassword) throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改密码');
    if (session) c.set('actor', session);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) requireSameOrigin(c.req.raw);
    await next();
};

export const internalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!c.env.INTERNAL_API_TOKEN || c.env.INTERNAL_API_TOKEN.length < 24) {
        throw new HttpError(503, 'INTERNAL_API_DISABLED', '尚未配置内部服务凭据');
    }
    const authorization = c.req.header('Authorization') ?? '';
    const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const [expected, actual] = await Promise.all([digest(c.env.INTERNAL_API_TOKEN), digest(provided)]);
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
    if (difference) throw new HttpError(401, 'INTERNAL_AUTH_REQUIRED', '需要内部服务凭据');
    await next();
};