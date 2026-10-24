import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { createDatabase } from '../db/index.ts';
import { accounts, accountRoles, credentials } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { digest, hashPassword, randomToken, verifyPassword } from './crypto.ts';

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const COOKIE_NAME = 'coursestack_session';
let dummyHash: Promise<string> | undefined;
const unauthorized = () => new HttpError(401, 'INVALID_CREDENTIALS', '登录凭据不正确或账号不可用');

export function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export async function readSession(binding: D1Database, request: Request) {
  const token = request.headers.get('cookie')?.split(';').map((v) => v.trim())
    .find((v) => v.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await digest(token);
  const row = await binding.prepare(`
    SELECT a.id, a.public_name AS publicName, s.credential_version AS version
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    JOIN credentials c ON c.account_id = a.id AND c.version = s.credential_version
    WHERE s.token_hash = ? AND s.expires_at > unixepoch() AND a.status = 'active'
  `).bind(tokenHash).first<{ id: string; publicName: string; version: number }>();
  return row ? { ...row, tokenHash } : null;
}

export async function requireSession(binding: D1Database, request: Request) {
  const session = await readSession(binding, request);
  if (!session) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录');
  return session;
}

export async function ownProfile(binding: D1Database, id: string) {
  const db = createDatabase(binding);
  const profile = await db.select({ id: accounts.id, publicName: accounts.publicName }).from(accounts)
    .where(eq(accounts.id, id)).get();
  const roles = await db.select({ role: accountRoles.role }).from(accountRoles).where(eq(accountRoles.accountId, id)).all();
  return { ...profile, roles: roles.map((r) => r.role) };
}

export async function limitAttempts(binding: D1Database, key: string, limit: number) {
  const now = Math.floor(Date.now() / 1000);
  const result = await createDatabase(binding).get<{ attempts: number }>(sql`
    INSERT INTO login_attempts (key, attempts, expires_at) VALUES (${await digest(key)}, 1, ${now + 900})
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN expires_at <= ${now} THEN 1 ELSE attempts + 1 END,
      expires_at = CASE WHEN expires_at <= ${now} THEN ${now + 900} ELSE expires_at END
    RETURNING attempts
  `);
  if (!result || result.attempts > limit) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', '尝试次数过多，请 15 分钟后重试');
}

export async function login(binding: D1Database, password: string, schoolNumber: string | null) {
  const db = createDatabase(binding);
  const administrator = db.select({ id: accountRoles.accountId }).from(accountRoles)
    .where(and(eq(accountRoles.accountId, accounts.id), eq(accountRoles.role, 'admin')));
  const candidate = await db.select({ id: accounts.id, passwordHash: credentials.passwordHash, version: credentials.version })
    .from(credentials).innerJoin(accounts, eq(accounts.id, credentials.accountId))
    .innerJoin(accountRoles, eq(accountRoles.accountId, accounts.id))
    .where(and(eq(accounts.status, 'active'), schoolNumber === null
      ? and(eq(accountRoles.role, 'admin'), sql`${credentials.schoolNumber} IS NULL`)
      : and(eq(credentials.schoolNumber, schoolNumber), inArray(accountRoles.role, ['student', 'teacher']), notExists(administrator)))).get();
  // Spend comparable hashing time for missing and disabled accounts as for bad passwords.
  const fallback = await (dummyHash ??= hashPassword(randomToken()));
  const valid = await verifyPassword(password, candidate?.passwordHash ?? fallback);
  if (!valid || !candidate) throw unauthorized();
  const token = randomToken();
  const tokenHash = await digest(token);
  // Recheck credential version/status in the write, preventing a concurrent reset
  // from issuing a session for the old password.
  const results = await binding.batch([
    binding.prepare(`INSERT INTO sessions (token_hash, account_id, credential_version, expires_at)
      SELECT ?, a.id, c.version, unixepoch() + ? FROM accounts a
      JOIN credentials c ON c.account_id = a.id
      WHERE a.id = ? AND a.status = 'active' AND c.version = ? AND c.password_hash = ?`)
      .bind(tokenHash, SESSION_SECONDS, candidate.id, candidate.version, candidate.passwordHash),
    binding.prepare('UPDATE accounts SET last_login_at = unixepoch() WHERE id = ? AND EXISTS (SELECT 1 FROM sessions WHERE token_hash = ?)')
      .bind(candidate.id, tokenHash),
    binding.prepare('DELETE FROM sessions WHERE expires_at <= unixepoch()'),
    binding.prepare('DELETE FROM login_attempts WHERE expires_at <= unixepoch()'),
  ]);
  if (results[0].meta.changes !== 1) throw unauthorized();
  return { token, profile: await ownProfile(binding, candidate.id) };
}

export async function changePassword(binding: D1Database, request: Request, oldPassword: string, newPassword: string) {
  const session = await requireSession(binding, request);
  await limitAttempts(binding, `password:${session.id}`, 10);
  const credential = await createDatabase(binding).select().from(credentials).where(eq(credentials.accountId, session.id)).get();
  if (!credential || !await verifyPassword(oldPassword, credential.passwordHash)) throw unauthorized();
  const passwordHash = await hashPassword(newPassword);
  const receipt = crypto.randomUUID();
  const target = `SELECT target_id FROM account_audit WHERE id = '${receipt}'`;
  const result = await binding.batch([
    binding.prepare(`INSERT INTO account_audit (id, actor_id, target_id, action, fields)
      SELECT ?, a.id, a.id, 'password.change', '["password"]' FROM accounts a
      JOIN credentials c ON c.account_id = a.id
      JOIN sessions s ON s.account_id = a.id AND s.credential_version = c.version
      WHERE a.id = ? AND a.status = 'active' AND c.version = ? AND c.password_hash = ?
        AND s.token_hash = ? AND s.expires_at > unixepoch()`)
      .bind(receipt, session.id, session.version, credential.passwordHash, session.tokenHash),
    binding.prepare(`UPDATE credentials SET password_hash = ?, version = version + 1 WHERE account_id IN (${target})`).bind(passwordHash),
    binding.prepare(`DELETE FROM sessions WHERE account_id IN (${target})`),
    binding.prepare(`DELETE FROM email_tokens WHERE account_id IN (${target})`),
  ]);
  if (result[0].meta.changes !== 1) throw new HttpError(409, 'SESSION_CHANGED', '会话已变化，请重新登录');
  // Version matching revokes every old session atomically with the password update.
}

/** Offline-only initialization; no HTTP route may call this function. */
export async function initializeAdministrator(binding: D1Database, password: string) {
  const db = createDatabase(binding);
  const existing = await db.select({ id: accountRoles.accountId }).from(accountRoles).where(eq(accountRoles.role, 'admin')).get();
  if (existing && await db.select({ id: credentials.accountId }).from(credentials).where(eq(credentials.accountId, existing.id)).get()) {
    throw new HttpError(409, 'ADMIN_EXISTS', '管理员已初始化，不能覆盖密码');
  }
  const passwordHash = await hashPassword(password);
  const id = existing?.id ?? crypto.randomUUID();
  await binding.batch([
    ...(!existing ? [
      binding.prepare('INSERT INTO accounts (id, public_name) VALUES (?, ?)').bind(id, '管理员'),
      binding.prepare("INSERT INTO account_roles (account_id, role) VALUES (?, 'admin')").bind(id),
    ] : []),
    binding.prepare('INSERT INTO credentials (account_id, school_number, password_hash) VALUES (?, NULL, ?)').bind(id, passwordHash),
    binding.prepare('INSERT INTO account_private (account_id) VALUES (?) ON CONFLICT(account_id) DO NOTHING').bind(id),
  ]);
}