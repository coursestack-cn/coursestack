import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { sessions } from '../db/schema.ts';
import type { Env } from '../env.ts';
import { HttpError, json, readJson, requireSameOrigin, stringField } from '../http.ts';
import { isAdministrator } from '../permissions.ts';
import { hashPassword, passwordField } from './crypto.ts';
import { changePassword, limitAttempts, login, ownProfile, readSession, requireSession, sessionCookie } from './service.ts';

const methods: Record<string, string> = {
  '/api/auth/login': 'POST',
  '/api/auth/admin/login': 'POST',
  '/api/auth/logout': 'POST',
  '/api/auth/me': 'GET',
  '/api/auth/password': 'POST',
  '/api/admin/accounts': 'POST',
};

export async function authRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const method = methods[path];
  if (!method) return null;
  if (request.method !== method) return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } }, 405, { Allow: method });
  if (method !== 'GET') requireSameOrigin(request);
  if (path === '/api/auth/me') {
    const session = await requireSession(env.DB, request);
    return json({ data: await ownProfile(env.DB, session.id) });
  }
  if (path === '/api/auth/logout') {
    const session = await readSession(env.DB, request);
    if (session) await createDatabase(env.DB).delete(sessions).where(eq(sessions.tokenHash, session.tokenHash));
    return json({ data: { loggedOut: true } }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
  }
  if (path === '/api/admin/accounts') {
    const session = await requireSession(env.DB, request);
    if (!await isAdministrator(createDatabase(env.DB), session.id)) throw new HttpError(403, 'FORBIDDEN', '需要管理员权限');
    const body = await readJson(request);
    if (body.role !== 'student' && body.role !== 'teacher') throw new HttpError(400, 'INVALID_ROLE', '只能创建学生或教师账号');
    const schoolNumber = stringField(body, 'schoolNumber', 64);
    const publicName = stringField(body, 'publicName');
    const realName = body.role === 'student' ? stringField(body, 'realName') : null;
    const passwordHash = await hashPassword(passwordField(body.password));
    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO accounts (id, public_name) VALUES (?, ?)').bind(id, publicName),
        env.DB.prepare('INSERT INTO account_roles (account_id, role) VALUES (?, ?)').bind(id, body.role),
        env.DB.prepare('INSERT INTO credentials (account_id, school_number, password_hash) VALUES (?, ?, ?)').bind(id, schoolNumber, passwordHash),
        ...(realName ? [env.DB.prepare('INSERT INTO student_records (account_id, student_number, real_name) VALUES (?, ?, ?)').bind(id, schoolNumber, realName)] : []),
      ]);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed.*(?:credentials.school_number|student_records.student_number)/.test(error.message)) {
        throw new HttpError(409, 'SCHOOL_NUMBER_EXISTS', '该学工号已存在');
      }
      throw error;
    }
    return json({ data: { id, publicName, role: body.role, schoolNumber } }, 201);
  }
  if (path === '/api/auth/password') {
    await requireSession(env.DB, request);
    const body = await readJson(request);
    await changePassword(env.DB, request, passwordField(body.oldPassword), passwordField(body.newPassword));
    return json({ data: { passwordChanged: true } }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
  }
  const body = await readJson(request);
  const schoolNumber = path === '/api/auth/admin/login' ? null : stringField(body, 'schoolNumber', 64);
  const password = passwordField(body.password);
  // CF-Connecting-IP is trusted only behind Cloudflare. Local requests share one bucket.
  const ip = env.APP_ENV === 'local' ? 'local' : request.headers.get('CF-Connecting-IP') ?? 'unknown';
  await limitAttempts(env.DB, `ip:${ip}`, 50);
  await limitAttempts(env.DB, schoolNumber === null ? 'admin-login' : `member:${schoolNumber}`, 10);
  const result = await login(env.DB, password, schoolNumber);
  return json({ data: result.profile }, 200, { 'Set-Cookie': sessionCookie(request, result.token) });
}