import { sql } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { HttpError } from '../http.ts';
import { digest, hashPassword, newPasswordField, randomToken, verifyPassword } from './crypto.ts';
import { mutateAccount, type Session } from '../accounts/mutations.ts';

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const COOKIE_NAME = 'coursestack_session';
const unauthorized = () => new HttpError(401, 'INVALID_CREDENTIALS', '登录凭据不正确或账号不可用');

export function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export async function readSession(binding: D1Database, request: Request) {
    const token = request.headers.get('cookie')?.split(';').map(v => v.trim())
        .find(v => v.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = await digest(token);
    const row = await binding.prepare(`SELECT a.id, a.nickname, a.role, a.credential_version AS version,
        a.must_change_password AS mustChangePassword
        FROM sessions s JOIN accounts a ON a.id = s.account_id AND a.credential_version = s.credential_version
        WHERE s.token_hash = ? AND s.expires_at > unixepoch() AND a.status = 'active' AND a.password IS NOT NULL`)
        .bind(tokenHash).first<{ id: string; nickname: string | null; role: 'student' | 'teacher' | 'admin';
            version: number; mustChangePassword: number }>();
    return row ? { ...row, mustChangePassword: Boolean(row.mustChangePassword), tokenHash } : null;
}
export async function requireSession(binding: D1Database, request: Request, options: { allowPasswordChange?: boolean } = {}) {
    const session = await readSession(binding, request);
    if (!session) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录');
    if (session.mustChangePassword && !options.allowPasswordChange) throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改密码');
    return session;
}
export async function ownProfile(binding: D1Database, id: string) {
    const row = await binding.prepare(`SELECT id, nickname, role, must_change_password AS mustChangePassword
        FROM accounts WHERE id = ? AND status <> 'deleted'`).bind(id)
        .first<{ id: string; nickname: string | null; role: 'student' | 'teacher' | 'admin'; mustChangePassword: number }>();
    if (!row) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
    return { ...row, mustChangePassword: Boolean(row.mustChangePassword) };
}
export async function limitAttempts(binding: D1Database, key: string, limit: number) {
    const now = Math.floor(Date.now() / 1000);
    const result = await createDatabase(binding).get<{ attempts: number }>(sql`
        INSERT INTO login_attempts (key, attempts, expires_at) VALUES (${await digest(key)}, 1, ${now + 900})
        ON CONFLICT(key) DO UPDATE SET
            attempts = CASE WHEN expires_at <= ${now} THEN 1 ELSE attempts + 1 END,
            expires_at = CASE WHEN expires_at <= ${now} THEN ${now + 900} ELSE expires_at END
        RETURNING attempts`);
    if (!result || result.attempts > limit) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', '尝试次数过多，请 15 分钟后重试');
}
export async function login(binding: D1Database, password: string, schoolNumber: string | null) {
    const candidate = await binding.prepare(`SELECT id, password, credential_version AS version
        FROM accounts WHERE status = 'active' AND password IS NOT NULL AND ${schoolNumber === null
            ? "role = 'admin' AND school_number IS NULL" : "role IN ('student','teacher') AND school_number = ?"}`)
        .bind(...(schoolNumber === null ? [] : [schoolNumber]))
        .first<{ id: string; password: string; version: number }>();
    const valid = await verifyPassword(password, candidate?.password);
    if (!valid || !candidate) throw unauthorized();
    const token = randomToken(), tokenHash = await digest(token);
    // Creating a new session must use credentials that are still valid. Already
    // authenticated business requests instead retain their entry snapshot.
    const results = await binding.batch([
        binding.prepare(`INSERT INTO sessions (token_hash, account_id, credential_version, expires_at)
            SELECT ?, id, credential_version, unixepoch() + ? FROM accounts
            WHERE id = ? AND status = 'active' AND credential_version = ? AND password = ?`)
            .bind(tokenHash, SESSION_SECONDS, candidate.id, candidate.version, candidate.password),
        binding.prepare('UPDATE accounts SET last_login_at = unixepoch() WHERE id = ? AND EXISTS (SELECT 1 FROM sessions WHERE token_hash = ?)')
            .bind(candidate.id, tokenHash),
        binding.prepare('DELETE FROM sessions WHERE expires_at <= unixepoch()'),
        binding.prepare('DELETE FROM login_attempts WHERE expires_at <= unixepoch()'),
    ]);
    if (results[0].meta.changes !== 1) throw unauthorized();
    return { token, profile: await ownProfile(binding, candidate.id) };
}
export async function changePassword(binding: D1Database, request: Request, oldPassword: string, newPassword: string, admitted?: Session) {
    const session = admitted ?? await requireSession(binding, request, { allowPasswordChange: true });
    newPasswordField(newPassword);
    await limitAttempts(binding, `password:${session.id}`, 10);
    const credential = await binding.prepare("SELECT password FROM accounts WHERE id = ? AND status <> 'deleted'")
        .bind(session.id).first<{ password: string | null }>();
    if (!credential?.password) throw unauthorized();
    if (!await verifyPassword(oldPassword, credential.password)) throw new HttpError(400, 'INVALID_CURRENT_PASSWORD', '当前密码不正确');
    if (session.mustChangePassword && oldPassword === newPassword) throw new HttpError(400, 'PASSWORD_UNCHANGED', '新密码不能与临时密码相同');
    const passwordHash = await hashPassword(newPassword);
    await mutateAccount(binding, session, session.id, false, gate => [
        binding.prepare(`UPDATE accounts SET password = ?, credential_version = credential_version + 1, must_change_password = 0 WHERE id = ? AND ${gate}`)
            .bind(passwordHash, session.id),
        binding.prepare(`DELETE FROM sessions WHERE account_id = ? AND ${gate}`).bind(session.id),
    ]);
}

export async function administratorState(binding: D1Database) {
    return binding.prepare(`SELECT id, status, CASE WHEN password IS NULL THEN NULL ELSE credential_version END AS version,
        school_number AS schoolNumber FROM accounts WHERE role = 'admin'`).first<{
            id: string; status: 'active' | 'disabled'; version: number | null; schoolNumber: string | null;
        }>();
}

/** Trusted maintenance only; no HTTP route may call this function. */
export async function initializeAdministrator(binding: D1Database, password: string) {
    const existing = await administratorState(binding);
    if (existing?.version !== null && existing?.version !== undefined) throw new HttpError(409, 'ADMIN_EXISTS', '管理员已初始化，不能覆盖密码');
    if (existing && existing.status !== 'active') throw new HttpError(409, 'ADMIN_UNAVAILABLE', '管理员状态异常，请先检查数据库');
    const passwordHash = await hashPassword(password), id = existing?.id ?? crypto.randomUUID();
    const result = await binding.batch([
        binding.prepare("INSERT INTO accounts (id, nickname, role) VALUES (?, '管理员', 'admin') ON CONFLICT(id) DO NOTHING").bind(id),
        binding.prepare("UPDATE accounts SET password = ? WHERE id = ? AND password IS NULL AND role = 'admin' AND status = 'active'").bind(passwordHash, id),
    ]);
    if (result[1].meta.changes !== 1) throw new HttpError(409, 'ADMIN_EXISTS', '管理员已初始化，不能覆盖密码');
    return { id };
}

/** External maintenance pins the administrator state explicitly inspected by its operator. */
export async function resetAdministratorPassword(binding: D1Database, password: string, expected: { id: string; version: number }) {
    if (!expected.id || !Number.isSafeInteger(expected.version) || expected.version < 1) throw new HttpError(400, 'INVALID_REVISION', '需要有效的管理员凭据版本');
    const passwordHash = await hashPassword(password);
    const gate = "EXISTS (SELECT 1 FROM accounts WHERE id = ? AND password = ? AND credential_version = ?)";
    const result = await binding.batch([
        binding.prepare(`UPDATE accounts SET password = ?, credential_version = credential_version + 1, must_change_password = 0
            WHERE id = ? AND role = 'admin' AND school_number IS NULL AND status = 'active' AND credential_version = ?`)
            .bind(passwordHash, expected.id, expected.version),
        binding.prepare(`DELETE FROM sessions WHERE account_id = ? AND ${gate}`)
            .bind(expected.id, expected.id, passwordHash, expected.version + 1),
        binding.prepare(`DELETE FROM login_attempts WHERE key IN (?, ?) AND ${gate}`)
            .bind(await digest('admin-login'), await digest(`password:${expected.id}`), expected.id, passwordHash, expected.version + 1),
    ]);
    if (result[0].meta.changes !== 1) throw new HttpError(409, 'ADMIN_CHANGED', '管理员凭据或状态已变化，请重新检查后操作');
    return { id: expected.id };
}