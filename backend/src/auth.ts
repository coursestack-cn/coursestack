import { getCookie } from 'hono/cookie';
import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { ApiError, db, hash, now, type Actor, type AppEnv } from './core';

// Replace this adapter with member 1's session verifier when integrating.
// No identity or role is ever accepted from X-User-Id/X-Role headers.
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('actor', null);
  const authorization = c.req.header('Authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  if (authorization && !bearer) throw new ApiError(401, 'INVALID_SESSION', '无效的登录凭据');
  const cookie = getCookie(c, c.env.APP_ENV === 'local' ? 'coursestack_session' : '__Host-coursestack_session');
  const token = bearer ?? cookie;
  if (token) {
    if (token.length < 16 || token.length > 512) throw new ApiError(401, 'INVALID_SESSION', '无效的登录凭据');
    const found = await db(c).get<Actor>(sql`SELECT u.id,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=${await hash(token)} AND s.expires_at>${now()} AND u.active=1`);
    if (!found) throw new ApiError(401, 'INVALID_SESSION', '登录已失效');
    c.set('actor', found);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    const allowed = new Set([new URL(c.req.url).origin, c.env.ALLOWED_ORIGIN].filter(Boolean));
    if ((origin && !allowed.has(origin)) || (cookie && !bearer && !origin)) {
      throw new ApiError(403, 'INVALID_ORIGIN', '请求来源校验失败');
    }
  }
  await next();
};

export const internalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.env.INTERNAL_API_TOKEN || c.env.INTERNAL_API_TOKEN.length < 24) {
    throw new ApiError(503, 'INTERNAL_API_DISABLED', '尚未配置内部服务凭据');
  }
  const authorization = c.req.header('Authorization') ?? '';
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  // Compare fixed length digests, rather than secret prefixes or user identity headers.
  const [a, b] = await Promise.all([hash(provided), hash(c.env.INTERNAL_API_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff !== 0) throw new ApiError(401, 'INTERNAL_AUTH_REQUIRED', '需要内部服务凭据');
  await next();
};