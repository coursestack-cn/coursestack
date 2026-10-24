import type { Env } from '../env.ts';
import { HttpError } from '../http.ts';

export type Mail = { to: string; subject: string; text: string };

export function mailOrigin(env: Env): string {
  let url: URL;
  try { url = new URL(env.PUBLIC_ORIGIN ?? ''); } catch { throw new HttpError(503, 'MAIL_UNAVAILABLE', '邮件服务尚未配置'); }
  if (url.origin !== env.PUBLIC_ORIGIN || (env.APP_ENV !== 'local' && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(503, 'MAIL_UNAVAILABLE', '邮件服务尚未配置');
  }
  if (env.APP_ENV !== 'local' && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) throw new HttpError(503, 'MAIL_UNAVAILABLE', '邮件服务尚未配置');
  return url.origin;
}

export async function sendMail(env: Env, mail: Mail) {
  mailOrigin(env);
  if (env.APP_ENV === 'local') {
    // Local inbox is private R2 storage, exported to ignored files by a CLI tool.
    // Do not print the message, address, reset token, or provider response in logs.
    await env.FILES.put(`local-mail/${crypto.randomUUID()}.json`, JSON.stringify(mail), { httpMetadata: { contentType: 'application/json' } });
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, ...mail }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new HttpError(503, 'MAIL_UNAVAILABLE', '邮件服务暂时不可用');
}