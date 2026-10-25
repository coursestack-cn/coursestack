import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { sessions } from '../db/schema.ts';
import type { Env } from '../env.ts';
import { HttpError, json, readJson, requireSameOrigin, stringField } from '../http.ts';
import { isAdministrator } from '../permissions.ts';
import { hashPassword, passwordField } from './crypto.ts';
import { changePassword, limitAttempts, login, ownProfile, readSession, requireSession, sessionCookie } from './service.ts';
import { allowFields, conflict, emailField } from '../accounts/validation.ts';

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
        allowFields(body, ['role', 'schoolNumber', 'publicName', 'realName', 'password', 'email']);
        if (body.role !== 'student' && body.role !== 'teacher') throw new HttpError(400, 'INVALID_ROLE', '只能创建学生或教师账号');
        const schoolNumber = stringField(body, 'schoolNumber', 64);
        const publicName = stringField(body, 'publicName');
        const realName = body.role === 'student' || body.realName !== undefined ? stringField(body, 'realName') : null;
        const email = body.email === undefined ? null : emailField(body.email);
        const passwordHash = await hashPassword(passwordField(body.password));
        const id = crypto.randomUUID();
        try {
            await env.DB.batch([
                env.DB.prepare(`INSERT INTO accounts (id, public_name) SELECT ?, ? WHERE EXISTS (
                    SELECT 1 FROM sessions s JOIN accounts a ON a.id = s.account_id
                    JOIN credentials c ON c.account_id = a.id AND c.version = s.credential_version
                    JOIN account_roles r ON r.account_id = a.id AND r.role = 'admin'
                    WHERE s.token_hash = ? AND s.expires_at > unixepoch() AND a.status = 'active')`).bind(id, publicName, session.tokenHash),
                env.DB.prepare('INSERT INTO account_roles (account_id, role) VALUES (?, ?)').bind(id, body.role),
                env.DB.prepare('INSERT INTO credentials (account_id, school_number, password_hash) VALUES (?, ?, ?)').bind(id, schoolNumber, passwordHash),
                env.DB.prepare('INSERT INTO account_private (account_id, real_name, email) VALUES (?, ?, ?)').bind(id, realName, email),
                ...(body.role === 'student' ? [env.DB.prepare('INSERT INTO student_records (account_id, student_number, real_name) VALUES (?, ?, ?)').bind(id, schoolNumber, realName)] : []),
                env.DB.prepare("INSERT INTO account_audit (id, actor_id, target_id, action, fields) VALUES (?, ?, ?, 'account.create', ?)")
                    .bind(crypto.randomUUID(), session.id, id, JSON.stringify(['role', 'schoolNumber', 'publicName', 'realName', 'email'])),
            ]);
        } catch (error) {
            conflict(error);
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