import type { Env } from '../env.ts';
import { HttpError, json, readJson } from '../http.ts';
import type { ManualTarget } from '../manual-routes.ts';
import { requireSession } from '../auth/service.ts';
import { createDatabase } from '../db/index.ts';
import { getPublicProfile } from '../permissions.ts';
import { accountDetail, deleteAccount, listAccounts, resetMemberPassword, updateAccount, updateNickname } from './service.ts';
import { removeUnusedAvatar } from './avatar.ts';

export async function accountRoutes(request: Request, env: Env, { path, encodedId, waitUntil }: ManualTarget): Promise<Response> {
    if (path === '/api/profiles/:id') {
        const data = await getPublicProfile(createDatabase(env.DB), decodeURIComponent(encodedId!));
        if (!data) throw new HttpError(404, 'PROFILE_NOT_FOUND', '公开资料不存在');
        return json({ data });
    }
    const session = await requireSession(env.DB, request);
    if (path === '/api/me/profile') return json({ data: request.method === 'PATCH'
        ? await updateNickname(env.DB, session, await readJson(request)) : await accountDetail(env.DB, session.id) });
    if (session.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '需要管理员权限');
    if (path === '/api/admin/accounts') return json({ data: await listAccounts(env.DB, new URL(request.url)) });
    const id = decodeURIComponent(encodedId!);
    if (request.method === 'DELETE') {
        const work = (async () => {
            const { avatarKey, ...data } = await deleteAccount(env.DB, session, id);
            if (avatarKey) await removeUnusedAvatar(env, avatarKey);
            return json({ data });
        })();
        waitUntil(work.then(() => undefined, () => undefined));
        return work;
    }
    if (path === '/api/admin/accounts/:id/password') return json({ data: await resetMemberPassword(env.DB, session, id, await readJson(request)) });
    return json({ data: request.method === 'PATCH'
        ? await updateAccount(env.DB, session, id, await readJson(request)) : await accountDetail(env.DB, id) });
}