import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../discussions/types.ts';
import { HttpError, json, keepAlive, readJson, sameOrigin } from '../http.ts';
import { requireSession } from '../auth/service.ts';
import { createDatabase } from '../db/index.ts';
import { getPublicProfile } from '../permissions.ts';
import { accountDetail, deleteAccount, listAccounts, resetMemberPassword, updateAccount, updateNickname } from './service.ts';
import { createMember } from './creation.ts';
import { removeUnusedAvatar } from './avatar.ts';

// These routes check the session themselves and are mounted ahead of the authenticated API.
export const accountRoutes = new Hono<AppEnv>();

async function administrator(c: Ctx) {
    const session = await requireSession(c.env.DB, c.req.raw);
    if (session.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '需要管理员权限');
    return session;
}

accountRoutes.get('/profiles/:id', async c => {
    const data = await getPublicProfile(createDatabase(c.env.DB), c.req.param('id'));
    if (!data) throw new HttpError(404, 'PROFILE_NOT_FOUND', '公开资料不存在');
    return json({ data });
});
accountRoutes.get('/me/profile', async c => {
    const session = await requireSession(c.env.DB, c.req.raw);
    return json({ data: await accountDetail(c.env.DB, session.id) });
});
accountRoutes.patch('/me/profile', sameOrigin(async c => {
    const session = await requireSession(c.env.DB, c.req.raw);
    return json({ data: await updateNickname(c.env.DB, session, await readJson(c.req.raw)) });
}));
accountRoutes.get('/admin/accounts', async c => {
    await administrator(c);
    return json({ data: await listAccounts(c.env.DB, new URL(c.req.url)) });
});
accountRoutes.post('/admin/accounts', sameOrigin(async c => {
    const session = await administrator(c);
    const body = await readJson(c.req.raw);
    return json({ data: await createMember(c.env.DB, session, body, c.req.header('Idempotency-Key')) }, 201);
}));
accountRoutes.get('/admin/accounts/:id', async c => {
    await administrator(c);
    return json({ data: await accountDetail(c.env.DB, c.req.param('id')) });
});
accountRoutes.patch('/admin/accounts/:id', sameOrigin(async c => {
    const session = await administrator(c);
    return json({ data: await updateAccount(c.env.DB, session, c.req.param('id')!, await readJson(c.req.raw)) });
}));
accountRoutes.delete('/admin/accounts/:id', sameOrigin(async c => {
    const session = await administrator(c), id = c.req.param('id')!;
    // Avatar cleanup continues after a client disconnect, so it is part of the kept-alive work.
    return keepAlive(c, (async () => {
        const { avatarKey, ...data } = await deleteAccount(c.env.DB, session, id);
        if (avatarKey) await removeUnusedAvatar(c.env, avatarKey);
        return json({ data });
    })());
}));
accountRoutes.post('/admin/accounts/:id/password', sameOrigin(async c => {
    const session = await administrator(c);
    return json({ data: await resetMemberPassword(c.env.DB, session, c.req.param('id')!, await readJson(c.req.raw)) });
}));