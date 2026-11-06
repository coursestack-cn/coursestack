import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword } from '../src/auth/crypto.ts';
import { doc, start } from './discussions-helpers.mjs';

// student-b holds the shared cookie while the page still shows student-a.
const stale = { headers: { 'X-Expected-Account': 'student-a' } };
const current = { headers: { 'X-Expected-Account': 'student-b' } };

test('a write stating another account is refused on every API stack and changes nothing', async () => {
    const app = await start();
    try {
        const question = await app.postQuestion('student-a');
        const answers = async () => (await app.api('GET', `/questions/${question}/answers`, 'student-b')).data.total;
        const nickname = async () => (await app.api('GET', '/me/profile', 'student-b')).data.nickname;
        const before = await nickname();
        const refused = [
            await app.api('POST', `/questions/${question}/answers`, 'student-b', { body: doc('以页面上的甲发布') }, stale),
            await app.api('PATCH', '/me/profile', 'student-b', { nickname: '不应改名' }, stale),
            await app.api('POST', '/auth/password', 'student-b', { oldPassword: 'unused', newPassword: 'unused-password' }, stale),
            await app.api('DELETE', '/me/avatar', 'student-b', undefined, stale),
            await app.api('POST', '/auth/logout', 'student-b', {}, stale),
        ];
        for (const response of refused) {
            assert.equal(response.status, 409);
            assert.equal(response.data.error.code, 'ACCOUNT_CHANGED');
        }
        assert.equal(await answers(), 0);
        assert.equal(await nickname(), before);
        assert.equal((await app.api('GET', '/auth/me', 'student-b')).status, 200, 'the refused logout must keep the session');
    } finally { await app.dispose(); }
});

test('reads, matching writes, clients without the header and login are unaffected', async () => {
    const app = await start();
    try {
        const question = await app.postQuestion('student-a');
        assert.equal((await app.api('GET', '/auth/me', 'student-b', undefined, stale)).data.id, 'student-b');
        assert.equal((await app.api('POST', `/questions/${question}/answers`, 'student-b', { body: doc('身份一致') }, current)).status, 201);
        assert.equal((await app.api('PATCH', '/me/profile', 'student-b', { nickname: '学习者乙二' })).status, 200);

        const password = 'fictional-password';
        await app.database.prepare('UPDATE accounts SET password=? WHERE id=?').bind(await hashPassword(password), 'student-b').run();
        assert.equal((await app.api('POST', '/auth/login', 'student-a', { schoolNumber: 'student-b', password }, stale)).data.id, 'student-b');
    } finally { await app.dispose(); }
});

test('a page whose session is gone still gets 401, so it returns to the login state', async () => {
    const app = await start();
    try {
        const response = await app.api('PATCH', '/me/profile', undefined, { nickname: '无会话' }, stale);
        assert.equal(response.status, 401);
    } finally { await app.dispose(); }
});