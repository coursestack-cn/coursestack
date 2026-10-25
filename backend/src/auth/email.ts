import type { Env } from '../env.ts';
import { HttpError, json, readJson, requireSameOrigin } from '../http.ts';
import { allowFields, emailField } from '../accounts/validation.ts';
import { digest, hashPassword, passwordField, randomToken } from './crypto.ts';
import { limitAttempts, requireSession, sessionCookie } from './service.ts';
import { mailOrigin, sendMail } from './mail.ts';

type Purpose = 'verify-email' | 'reset-password';
type Recipient = { id: string; email: string; emailVersion: number; credentialVersion: number };
const genericAccepted = () => json({ data: { message: '如果该邮箱符合条件，将收到操作邮件，请检查收件箱。' } }, 202);
const invalidToken = () => new HttpError(400, 'INVALID_EMAIL_TOKEN', '链接无效或已过期，请重新申请');

async function issueToken(env: Env, recipient: Recipient, purpose: Purpose) {
    const token = randomToken();
    const tokenHash = await digest(token);
    const result = await env.DB.batch([
        // A stale recipient snapshot must not delete links issued for newer versions.
        env.DB.prepare(`DELETE FROM email_tokens WHERE account_id = ? AND purpose = ?
            AND email_version = ? AND credential_version = ?`)
            .bind(recipient.id, purpose, recipient.emailVersion, recipient.credentialVersion),
        env.DB.prepare(`INSERT INTO email_tokens (token_hash, account_id, purpose, email_version, credential_version, expires_at)
            SELECT ?, a.id, ?, p.email_version, c.version, unixepoch() + 1800
            FROM accounts a JOIN account_private p ON p.account_id = a.id JOIN credentials c ON c.account_id = a.id
            WHERE a.id = ? AND a.status = 'active' AND p.email = ? AND p.email_version = ? AND c.version = ?`)
            .bind(tokenHash, purpose, recipient.id, recipient.email, recipient.emailVersion, recipient.credentialVersion),
        env.DB.prepare('DELETE FROM email_tokens WHERE expires_at <= unixepoch()'),
    ]);
    if (result[1].meta.changes !== 1) return;
    // Fragment tokens do not enter HTTP access logs or Referer headers. Frontend
    // reads the fragment and submits it to the confirmation API in a JSON body.
    const link = `${mailOrigin(env)}/${purpose}#token=${token}`;
    try {
        await sendMail(env, { to: recipient.email,
            subject: purpose === 'verify-email' ? 'CourseStack 邮箱验证' : 'CourseStack 密码重置',
            text: `请在 30 分钟内打开以下链接完成${purpose === 'verify-email' ? '邮箱验证' : '密码重置'}：\n${link}\n若非本人操作，请忽略本邮件。`,
        });
    } catch {
        await env.DB.prepare('DELETE FROM email_tokens WHERE token_hash = ?').bind(tokenHash).run();
        throw new HttpError(503, 'MAIL_UNAVAILABLE', '邮件服务暂时不可用');
    }
}

export async function consumeEmailToken(env: Env, token: string, purpose: Purpose, password?: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw invalidToken();
    const tokenHash = await digest(token);
    const eligible = `FROM email_tokens t JOIN accounts a ON a.id = t.account_id AND a.status = 'active'
        JOIN account_private p ON p.account_id = a.id AND p.email_version = t.email_version AND p.email IS NOT NULL
        JOIN credentials c ON c.account_id = a.id AND c.version = t.credential_version
        WHERE t.token_hash = ? AND t.purpose = ? AND t.expires_at > unixepoch()
            ${purpose === 'reset-password' ? 'AND p.email_verified_at IS NOT NULL' : ''}`;
    if (!await env.DB.prepare(`SELECT a.id ${eligible}`).bind(tokenHash, purpose).first()) throw invalidToken();
    const passwordHash = purpose === 'reset-password' ? await hashPassword(password!) : null;
    const receipt = crypto.randomUUID();
    const target = `SELECT target_id FROM account_audit WHERE id = '${receipt}'`;
    const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO account_audit (id, actor_id, target_id, action, fields)
            SELECT ?, NULL, a.id, ?, ? ${eligible}`)
            .bind(receipt, purpose === 'reset-password' ? 'password.recover' : 'email.verify', JSON.stringify([purpose === 'reset-password' ? 'password' : 'emailVerifiedAt']), tokenHash, purpose),
        ...(purpose === 'reset-password' ? [
            env.DB.prepare(`UPDATE credentials SET password_hash = ?, version = version + 1 WHERE account_id IN (${target})`).bind(passwordHash),
            env.DB.prepare(`DELETE FROM sessions WHERE account_id IN (${target})`),
        ] : [env.DB.prepare(`UPDATE account_private SET email_verified_at = unixepoch() WHERE account_id IN (${target})`)]),
        env.DB.prepare(`UPDATE accounts SET revision = revision + 1 WHERE id IN (${target})`),
        env.DB.prepare(`DELETE FROM email_tokens WHERE account_id IN (${target})`),
    ]);
    if (results[0].meta.changes !== 1) throw invalidToken();
}

export async function emailRoutes(request: Request, env: Env): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (!['/api/auth/email/verification', '/api/auth/email/verify', '/api/auth/password/forgot', '/api/auth/password/reset'].includes(path)) return null;
    if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } }, 405, { Allow: 'POST' });
    requireSameOrigin(request);
    const ip = env.APP_ENV === 'local' ? 'local' : request.headers.get('CF-Connecting-IP') ?? 'unknown';
    await limitAttempts(env.DB, `email-ip:${ip}`, 30);
    if (path === '/api/auth/email/verification') {
        const session = await requireSession(env.DB, request);
        mailOrigin(env);
        await limitAttempts(env.DB, `email-verify:${session.id}`, 3);
        const recipient = await env.DB.prepare(`SELECT a.id, p.email, p.email_version AS emailVersion, c.version AS credentialVersion
            FROM accounts a JOIN account_private p ON p.account_id = a.id JOIN credentials c ON c.account_id = a.id
            WHERE a.id = ? AND a.status = 'active' AND p.email IS NOT NULL AND p.email_verified_at IS NULL`).bind(session.id).first<Recipient>();
        if (!recipient) throw new HttpError(409, 'EMAIL_NOT_PENDING', '请先由管理员设置邮箱，或邮箱已经验证');
        await issueToken(env, recipient, 'verify-email');
        return genericAccepted();
    }
    const body = await readJson(request);
    if (path === '/api/auth/password/forgot') {
        allowFields(body, ['email']);
        const email = emailField(body.email);
        if (!email) throw new HttpError(400, 'INVALID_EMAIL', '请输入邮箱');
        mailOrigin(env);
        await limitAttempts(env.DB, `email-recover:${email}`, 3);
        const recipient = await env.DB.prepare(`SELECT a.id, p.email, p.email_version AS emailVersion, c.version AS credentialVersion
            FROM account_private p JOIN accounts a ON a.id = p.account_id JOIN credentials c ON c.account_id = a.id
            WHERE p.email = ? AND p.email_verified_at IS NOT NULL AND a.status = 'active'`).bind(email).first<Recipient>();
        if (recipient) {
            // Keep public responses identical for nonexistent, unverified, disabled and
            // eligible addresses, including provider failures. No delivery claim is made.
            try { await issueToken(env, recipient, 'reset-password'); } catch { /* request remains non-enumerating */ }
        }
        return genericAccepted();
    }
    const reset = path === '/api/auth/password/reset';
    allowFields(body, reset ? ['token', 'newPassword'] : ['token']);
    if (typeof body.token !== 'string') throw invalidToken();
    const password = reset ? passwordField(body.newPassword) : undefined;
    await consumeEmailToken(env, body.token, reset ? 'reset-password' : 'verify-email', password);
    return json({ data: reset ? { passwordChanged: true } : { emailVerified: true } }, 200,
        reset ? { 'Set-Cookie': sessionCookie(request, '', 0) } : {});
}