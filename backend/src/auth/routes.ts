import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { sessions } from '../db/schema.ts';
import type { Env } from '../env.ts';
import { HttpError, json, readJson, requireSameOrigin, stringField } from '../http.ts';
import { existingPasswordField, newPasswordField } from './crypto.ts';
import { changePassword, limitAttempts, login, ownProfile, readSession, requireSession, sessionCookie } from './service.ts';
import { allowFields } from '../accounts/validation.ts';
import { createMember } from '../accounts/creation.ts';

const methods: Record<string, string> = {
    '/api/auth/login': 'POST', '/api/auth/admin/login': 'POST', '/api/auth/logout': 'POST',
    '/api/auth/me': 'GET', '/api/auth/password': 'POST', '/api/admin/accounts': 'POST',
};
export async function authRoutes(request: Request, env: Env): Promise<Response | null> {
    const path = new URL(request.url).pathname, method = methods[path];
    if (!method) return null;
    if (request.method !== method) return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } }, 405, { Allow: method });
    if (method !== 'GET') requireSameOrigin(request);
    if (path === '/api/auth/me') {
        const session = await requireSession(env.DB, request, { allowPasswordChange: true });
        return json({ data: await ownProfile(env.DB, session.id) });
    }
    if (path === '/api/auth/logout') {
        const session = await readSession(env.DB, request);
        if (session) await createDatabase(env.DB).delete(sessions).where(eq(sessions.tokenHash, session.tokenHash));
        return json({ data: { loggedOut: true } }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
    }
    if (path === '/api/admin/accounts') {
        const session = await requireSession(env.DB, request);
        if (session.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '需要管理员权限');
        const body = await readJson(request);
        return json({ data: await createMember(env.DB, session, body, request.headers.get('Idempotency-Key') ?? undefined) }, 201);
    }
    if (path === '/api/auth/password') {
        const session = await requireSession(env.DB, request, { allowPasswordChange: true });
        const body = await readJson(request);
        allowFields(body, ['oldPassword', 'newPassword']);
        await changePassword(env.DB, request, existingPasswordField(body.oldPassword), newPasswordField(body.newPassword), session);
        return json({ data: { passwordChanged: true } }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
    }
    const body = await readJson(request);
    const schoolNumber = path === '/api/auth/admin/login' ? null : stringField(body, 'schoolNumber', 64);
    const password = existingPasswordField(body.password);
    const ip = env.APP_ENV === 'local' ? 'local' : request.headers.get('CF-Connecting-IP') ?? 'unknown';
    await limitAttempts(env.DB, `ip:${ip}`, 50);
    await limitAttempts(env.DB, schoolNumber === null ? 'admin-login' : `member:${schoolNumber}`, 10);
    const result = await login(env.DB, password, schoolNumber);
    return json({ data: result.profile }, 200, { 'Set-Cookie': sessionCookie(request, result.token) });
}