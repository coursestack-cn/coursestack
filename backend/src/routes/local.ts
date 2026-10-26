import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError, db, hash, input, now, uid, type Actor, type AppEnv, type Ctx } from '../core';

// Local fixture sessions only. Member 1 implements the real login flow.
// Both environment and loopback URL must match, so this is closed in dev/prod.
export const localRoutes = new Hono<AppEnv>();
export function isLocalRequest(c: Ctx) {
  return c.env.APP_ENV === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname);
}
localRoutes.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (!isLocalRequest(c)) {
    throw new ApiError(404, 'NOT_FOUND', '接口不存在');
  }
  const origin = c.req.header('Origin');
  if (origin && origin !== c.env.ALLOWED_ORIGIN && origin !== url.origin) {
    throw new ApiError(403, 'INVALID_ORIGIN', '请求来源校验失败');
  }
  await next();
});
localRoutes.get('/versions', async c => {
  const courseId = c.req.query('courseId');
  if (!courseId || courseId.length > 100) throw new ApiError(400, 'COURSE_REQUIRED', '需要课程ID');
  const items = await db(c).all<{ id: string; filename: string; version: number; materialId: string }>(sql`
    SELECT v.id,v.filename,v.version,v.material_id AS materialId FROM file_versions v JOIN materials m ON m.id=v.material_id
    WHERE m.course_id=${courseId} AND m.status='visible' AND v.status='visible' ORDER BY m.id,v.version DESC LIMIT 100`);
  return c.json({ items });
});
localRoutes.post('/session', async c => {
  const data = await input(c, z.object({ userId: z.enum(['student-a', 'student-b', 'visitor', 'teacher-a', 'teacher-b', 'admin']) }).strict());
  const user = await db(c).get<Actor>(sql`SELECT id,display_name,role FROM users WHERE id=${data.userId} AND active=1`);
  if (!user) throw new ApiError(409, 'LOCAL_SEED_REQUIRED', '请先运行 pnpm db:seed:local');
  const token = uid() + uid(), at = now(), expiresAt = new Date(Date.now() + 86400000).toISOString();
  await db(c).run(sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${await hash(token)},${user.id},${expiresAt})`);
  setCookie(c, 'coursestack_session', token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 86400 });
  return c.json({ user: { id: user.id, displayName: user.display_name, role: user.role }, createdAt: at });
});
localRoutes.delete('/session', async c => {
  const token = getCookie(c, 'coursestack_session');
  if (token) await db(c).run(sql`DELETE FROM sessions WHERE token_hash=${await hash(token)}`);
  deleteCookie(c, 'coursestack_session', { path: '/' });
  return c.json({ ok: true });
});