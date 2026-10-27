import type { Env } from '../env.ts';
import { HttpError, json, readJson, requireSameOrigin } from '../http.ts';
import { requireSession } from '../auth/service.ts';
import { createDatabase } from '../db/index.ts';
import { getPublicProfile } from '../permissions.ts';
import { accountDetail, deleteAccount, listAccounts, resetMemberPassword, updateAccount, updateNickname } from './service.ts';
import { removeUnusedAvatar } from './avatar.ts';

export async function accountRoutes(request: Request, env: Env, waitUntil?: (work: Promise<unknown>) => void): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname;
    const account = path.match(/^\/api\/admin\/accounts\/([^/]+)(\/password)?$/);
    const profile = path.match(/^\/api\/profiles\/([^/]+)$/);
    const list = path === '/api/admin/accounts' && request.method !== 'POST';
    const own = path === '/api/me/profile';
    if (!account && !profile && !list && !own) return null;
    const password = account?.[2] === '/password';
    const allowed = password ? ['POST'] : own ? ['GET', 'PATCH'] : account && !account[2] ? ['GET', 'PATCH', 'DELETE'] : ['GET'];
    if (!allowed.includes(request.method)) return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } }, 405, { Allow: list ? 'GET, POST' : allowed.join(', ') });
    if (request.method !== 'GET') requireSameOrigin(request);
    if (profile) {
        const data = await getPublicProfile(createDatabase(env.DB), decodeURIComponent(profile[1]));
        if (!data) throw new HttpError(404, 'PROFILE_NOT_FOUND', '公开资料不存在');
        return json({ data });
    }
    const session = await requireSession(env.DB, request);
    if (own) return json({ data: request.method === 'PATCH'
        ? await updateNickname(env.DB, session, await readJson(request)) : await accountDetail(env.DB, session.id) });
    if (session.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '需要管理员权限');
    if (list) return json({ data: await listAccounts(env.DB, url) });
    const id = decodeURIComponent(account![1]);
    if (request.method === 'DELETE') {
        const work = (async () => {
            const { avatarKey, ...data } = await deleteAccount(env.DB, session, id);
            if (avatarKey) await removeUnusedAvatar(env, avatarKey);
            return json({ data });
        })();
        waitUntil?.(work.then(() => undefined, () => undefined));
        return work;
    }
    if (password) return json({ data: await resetMemberPassword(env.DB, session, id, await readJson(request)) });
    return json({ data: request.method === 'PATCH'
        ? await updateAccount(env.DB, session, id, await readJson(request)) : await accountDetail(env.DB, id) });
}