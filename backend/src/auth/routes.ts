import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { sessions } from '../db/schema.ts';
import type { Env } from '../env.ts';
import { HttpError, json, readJson, requireSameOrigin, stringField } from '../http.ts';
import { hashPassword, newPasswordField, passwordField } from './crypto.ts';
import { changePassword, limitAttempts, login, ownProfile, readSession, requireSession, sessionCookie } from './service.ts';
import { allowFields, conflict } from '../accounts/validation.ts';
import { accountDetail, profileValues } from '../accounts/service.ts';

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
        allowFields(body, ['role', 'schoolNumber', 'nickname', 'name', 'password', 'department', 'major', 'grade']);
        if (body.role !== 'student' && body.role !== 'teacher') throw new HttpError(400, 'INVALID_ROLE', '只能创建学生或教师账号');
        const schoolNumber = stringField(body, 'schoolNumber', 64), nickname = stringField(body, 'nickname');
        const profile = profileValues(body);
        if (body.role === 'student' && !profile.name) throw new HttpError(400, 'STUDENT_IDENTITY_REQUIRED', '学生需要姓名和学号');
        const passwordHash = await hashPassword(passwordField(body.password)), id = crypto.randomUUID();
        try {
            const results = await env.DB.batch([
                env.DB.prepare(`INSERT INTO accounts (id, nickname, role, school_number, password, name, department, major, grade)
                    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
                        SELECT 1 FROM accounts WHERE id = ? AND data_generation = ? AND status <> 'deleted')`)
                    .bind(id, nickname, body.role, schoolNumber, passwordHash, profile.name ?? null, profile.department ?? null,
                        profile.major ?? null, profile.grade ?? null, session.id, session.dataGeneration),
                env.DB.prepare(`INSERT INTO account_audit (id, actor_id, target_id, action, fields)
                    SELECT ?, ?, id, 'account.create', ? FROM accounts WHERE id = ?`)
                    .bind(crypto.randomUUID(), session.id, JSON.stringify(Object.keys(body).filter(key => key !== 'password')), id),
            ]);
            if (results[0].meta.changes !== 1) throw new HttpError(409, 'ACCOUNT_RETIRED', '操作者身份已变更');
        } catch (error) { conflict(error); }
        return json({ data: await accountDetail(env.DB, id) }, 201);
    }
    if (path === '/api/auth/password') {
        const session = await requireSession(env.DB, request, { allowPasswordChange: true });
        const body = await readJson(request);
        allowFields(body, ['oldPassword', 'newPassword']);
        await changePassword(env.DB, request, passwordField(body.oldPassword), newPasswordField(body.newPassword), session);
        return json({ data: { passwordChanged: true } }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
    }
    const body = await readJson(request);
    const schoolNumber = path === '/api/auth/admin/login' ? null : stringField(body, 'schoolNumber', 64);
    const password = passwordField(body.password);
    const ip = env.APP_ENV === 'local' ? 'local' : request.headers.get('CF-Connecting-IP') ?? 'unknown';
    await limitAttempts(env.DB, `ip:${ip}`, 50);
    await limitAttempts(env.DB, schoolNumber === null ? 'admin-login' : `member:${schoolNumber}`, 10);
    const result = await login(env.DB, password, schoolNumber);
    return json({ data: result.profile }, 200, { 'Set-Cookie': sessionCookie(request, result.token) });
}