import type { Env } from '../env.ts';
import { HttpError, json, readJson, requireSameOrigin } from '../http.ts';
import { requireSession } from '../auth/service.ts';
import { createDatabase } from '../db/index.ts';
import { getPublicProfile, getStudentRecordForTeacher, isAdministrator } from '../permissions.ts';
import { accountDetail, accountHistory, listAccounts, updateAccount, updatePublicName } from './service.ts';

export async function accountRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const account = path.match(/^\/api\/admin\/accounts\/([^/]+)(\/audit)?$/);
  const profile = path.match(/^\/api\/profiles\/([^/]+)$/);
  const academic = path.match(/^\/api\/courses\/([^/]+)\/students\/([^/]+)\/academic-record$/);
  const list = path === '/api/admin/accounts' && request.method !== 'POST';
  const own = path === '/api/me/profile';
  if (!account && !profile && !academic && !list && !own) return null;
  const allowed = own || (account && !account[2]) ? ['GET', 'PATCH'] : ['GET'];
  if (!allowed.includes(request.method)) return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } }, 405, { Allow: list ? 'GET, POST' : allowed.join(', ') });
  if (request.method === 'PATCH') requireSameOrigin(request);
  if (profile) {
    const data = await getPublicProfile(createDatabase(env.DB), decodeURIComponent(profile[1]));
    if (!data) throw new HttpError(404, 'PROFILE_NOT_FOUND', '公开资料不存在');
    return json({ data });
  }
  const session = await requireSession(env.DB, request);
  if (own) return json({ data: request.method === 'PATCH'
    ? await updatePublicName(env.DB, session, await readJson(request)) : await accountDetail(env.DB, session.id) });
  if (academic) {
    const data = await getStudentRecordForTeacher(createDatabase(env.DB), session.id, decodeURIComponent(academic[1]), decodeURIComponent(academic[2]));
    if (!data) throw new HttpError(404, 'ACADEMIC_RECORD_NOT_FOUND', '学籍不存在或无权访问');
    return json({ data });
  }
  if (!await isAdministrator(createDatabase(env.DB), session.id)) throw new HttpError(403, 'FORBIDDEN', '需要管理员权限');
  if (list) return json({ data: await listAccounts(env.DB, url) });
  const id = decodeURIComponent(account![1]);
  return json({ data: account![2] ? await accountHistory(env.DB, id, url) : request.method === 'PATCH'
    ? await updateAccount(env.DB, session, id, await readJson(request)) : await accountDetail(env.DB, id) });
}