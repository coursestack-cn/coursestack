import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passwordField, newPasswordField } from '../src/auth/crypto.ts';
import { start } from './discussions-helpers.mjs';

const cookieOf = (response) => response.headers.get('set-cookie')?.split(';')[0];
async function request(app, path, cookie, body) {
    return app.worker.fetch(`http://localhost/api${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), 'Idempotency-Key': crypto.randomUUID() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const login = (app, password, number = 'student-a') => request(app, '/auth/login', undefined, { schoolNumber: number, password });

test('short temporary passwords force a real change, persist across logins, and block both API stacks', async () => {
    const app = await start();
    try {
        const reset = await app.api('POST', '/admin/accounts/student-a/password', 'admin', { newPassword: 'S0001', mustChangePassword: true });
        assert.equal(reset.status, 200);
        assert.equal(reset.data.mustChangePassword, true);
        assert.equal(reset.data.generatedPassword, undefined);
        assert.equal((await app.api('GET', '/auth/me', 'student-a')).status, 401);
        const first = await login(app, 'S0001'), second = await login(app, 'S0001');
        assert.equal(first.status, 200);
        assert.equal((await first.json()).data.mustChangePassword, true);
        const auth = cookieOf(first), other = cookieOf(second);
        assert.equal((await (await request(app, '/auth/me', auth)).json()).data.mustChangePassword, true);
        for (const [path, body] of [['/me/profile'], ['/courses/course-a/questions', { title: '不能绕过改密', body: '问题' }], ['/notifications']]) {
            const blocked = await request(app, path, auth, body);
            assert.equal(blocked.status, 403, path);
            assert.equal((await blocked.json()).error.code, 'PASSWORD_CHANGE_REQUIRED');
        }
        assert.equal((await request(app, '/auth/password', auth, { oldPassword: 'S0001', newPassword: '1234567' })).status, 400);
        const wrong = await request(app, '/auth/password', auth, { oldPassword: 'wrong', newPassword: '12345678' });
        assert.equal(wrong.status, 400);
        assert.equal((await wrong.json()).error.code, 'INVALID_CURRENT_PASSWORD');
        assert.equal((await request(app, '/auth/me', auth)).status, 200);
        const changed = await request(app, '/auth/password', auth, { oldPassword: 'S0001', newPassword: '12345678' });
        assert.equal(changed.status, 200);
        assert.match(changed.headers.get('set-cookie'), /Max-Age=0/);
        for (const old of [auth, other]) assert.equal((await request(app, '/auth/me', old)).status, 401);
        assert.equal((await login(app, 'S0001')).status, 401);
        const newLogin = await login(app, '12345678');
        assert.equal((await newLogin.clone().json()).data.mustChangePassword, false);
        assert.equal((await request(app, '/me/profile', cookieOf(newLogin))).status, 200);
        const question = await request(app, '/courses/course-a/questions', cookieOf(newLogin), { title: '改密后正常提问', body: '内容' });
        assert.equal(question.status, 201);
    } finally { await app.dispose(); }
});

test('omitted or empty reset passwords are generated once, optional flag is validated and can be cleared', async () => {
    const app = await start();
    try {
        const first = await app.api('POST', '/admin/accounts/student-a/password', 'admin', { mustChangePassword: true });
        assert.equal(first.status, 200);
        assert.match(first.data.generatedPassword, /^[a-f0-9]{24}$/);
        const loggedIn = await login(app, first.data.generatedPassword);
        const same = await request(app, '/auth/password', cookieOf(loggedIn), { oldPassword: first.data.generatedPassword, newPassword: first.data.generatedPassword });
        assert.equal(same.status, 400);
        assert.equal((await same.json()).error.code, 'PASSWORD_UNCHANGED');
        assert.equal((await request(app, '/auth/logout', cookieOf(loggedIn), {})).status, 200);
        assert.equal((await (await login(app, first.data.generatedPassword)).json()).data.mustChangePassword, true);
        for (const path of ['/admin/accounts/student-a', '/admin/accounts', '/admin/accounts/student-a/audit']) {
            const response = await app.api('GET', path, 'admin');
            assert.ok(!JSON.stringify(response.data).includes(first.data.generatedPassword));
            assert.ok(!JSON.stringify(response.data).includes('generatedPassword'));
        }
        for (const flag of [null, 1, 'true']) {
            assert.equal((await app.api('POST', '/admin/accounts/student-a/password', 'admin', { newPassword: 'S0001', mustChangePassword: flag })).status, 400);
        }
        const second = await app.api('POST', '/admin/accounts/student-a/password', 'admin', { newPassword: '' });
        assert.equal(second.status, 200);
        assert.match(second.data.generatedPassword, /^[a-f0-9]{24}$/);
        assert.notEqual(second.data.generatedPassword, first.data.generatedPassword);
        assert.equal(second.data.mustChangePassword, false);
        const short = await app.api('POST', '/admin/accounts/student-a/password', 'admin', { newPassword: 'a', mustChangePassword: false });
        assert.equal(short.status, 200);
        const allowed = await login(app, 'a');
        assert.equal(allowed.status, 200);
        assert.equal((await request(app, '/me/profile', cookieOf(allowed))).status, 200);
    } finally { await app.dispose(); }
});

test('admin provisioning accepts short passwords while self-selected passwords require eight Unicode characters', async () => {
    assert.equal(passwordField('a'), 'a');
    assert.equal(passwordField('    '), '    ');
    for (const value of ['', null, 123, '密'.repeat(25)]) assert.throws(() => passwordField(value));
    for (const value of ['1234567', '😀'.repeat(7), '密'.repeat(25)]) assert.throws(() => newPasswordField(value));
    assert.equal(newPasswordField('😀'.repeat(8)), '😀'.repeat(8));
    assert.equal(newPasswordField('密'.repeat(24)), '密'.repeat(24));
    const app = await start();
    try {
        const created = await app.api('POST', '/admin/accounts', 'admin', { role: 'student', schoolNumber: 'S0099', nickname: '演示同学', name: '虚构同学', password: 'S0099' });
        assert.equal(created.status, 201);
        assert.equal((await login(app, 'S0099', 'S0099')).status, 200);
    } finally { await app.dispose(); }
});