import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { sessions } from '../db/schema.ts';
import type { Env } from '../env.ts';
import { HttpError, json, readJson, stringField } from '../http.ts';
import type { ManualTarget } from '../manual-routes.ts';
import { existingPasswordField, newPasswordField } from './crypto.ts';
import { changePassword, limitAttempts, ownProfile, readSession, requireSession, sessionCookie, signIn } from './service.ts';
import { allowFields } from '../accounts/validation.ts';
import { createMember } from '../accounts/creation.ts';

export async function authRoutes(request: Request, env: Env, { path }: ManualTarget): Promise<Response> {
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
    const result = await signIn(env.DB, password, schoolNumber, ip);
    return json({ data: result.profile }, 200, { 'Set-Cookie': sessionCookie(request, result.token) });
}