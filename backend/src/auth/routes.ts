import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDatabase } from '../db/index.ts';
import { sessions } from '../db/schema.ts';
import type { AppEnv, Ctx } from '../discussions/types.ts';
import { json, readJson, sameOrigin, stringField } from '../http.ts';
import { existingPasswordField, newPasswordField } from './crypto.ts';
import { changePassword, limitAttempts, ownProfile, readSession, requireSession, sessionCookie, signIn } from './service.ts';
import { allowFields } from '../accounts/validation.ts';

// Mounted ahead of the authenticated API: these routes read the session themselves,
// so a pending password change can still query its identity, log out and change the password.
export const authRoutes = new Hono<AppEnv>();

async function login(c: Ctx, admin: boolean) {
    const body = await readJson(c.req.raw);
    const schoolNumber = admin ? null : stringField(body, 'schoolNumber', 64);
    const password = existingPasswordField(body.password);
    const ip = c.env.APP_ENV === 'local' ? 'local' : c.req.header('CF-Connecting-IP') ?? 'unknown';
    await limitAttempts(c.env.DB, `ip:${ip}`, 50);
    const result = await signIn(c.env.DB, password, schoolNumber, ip);
    return json({ data: result.profile }, 200, { 'Set-Cookie': sessionCookie(c.req.raw, result.token) });
}

authRoutes.post('/auth/login', sameOrigin(c => login(c, false)));
authRoutes.post('/auth/admin/login', sameOrigin(c => login(c, true)));
authRoutes.post('/auth/logout', sameOrigin(async c => {
    const session = await readSession(c.env.DB, c.req.raw);
    if (session) await createDatabase(c.env.DB).delete(sessions).where(eq(sessions.tokenHash, session.tokenHash));
    return json({ data: { loggedOut: true } }, 200, { 'Set-Cookie': sessionCookie(c.req.raw, '', 0) });
}));
authRoutes.get('/auth/me', async c => {
    const session = await requireSession(c.env.DB, c.req.raw, { allowPasswordChange: true });
    return json({ data: await ownProfile(c.env.DB, session.id) });
});
authRoutes.post('/auth/password', sameOrigin(async c => {
    const session = await requireSession(c.env.DB, c.req.raw, { allowPasswordChange: true });
    const body = await readJson(c.req.raw);
    allowFields(body, ['oldPassword', 'newPassword']);
    await changePassword(c.env.DB, c.req.raw, existingPasswordField(body.oldPassword), newPasswordField(body.newPassword), session);
    return json({ data: { passwordChanged: true } }, 200, { 'Set-Cookie': sessionCookie(c.req.raw, '', 0) });
}));