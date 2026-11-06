import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existingPasswordField, passwordField, newPasswordField } from '../src/auth/crypto.ts';
import { start, doc } from './discussions-helpers.mjs';

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
        for (const [path, body] of [['/me/profile'], ['/courses/course-a/questions', { title: '不能绕过改密', body: doc('问题') }], ['/notifications']]) {
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
        const question = await request(app, '/courses/course-a/questions', cookieOf(newLogin), { title: '改密后正常提问', body: doc('内容') });
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
        for (const path of ['/admin/accounts/student-a', '/admin/accounts']) {
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

test('admin provisioning accepts short passwords while self-selected passwords require 8-64 Unicode characters', async () => {
    assert.equal(passwordField('a'), 'a');
    assert.equal(passwordField('    '), '    ');
    for (const value of ['', null, 123]) assert.throws(() => passwordField(value), { code: 'INVALID_PASSWORD' });
    for (const character of ['a', '密', '😀']) {
        assert.throws(() => passwordField(character.repeat(65)), { code: 'INVALID_PASSWORD' });
        for (const length of [7, 65]) assert.throws(() => newPasswordField(character.repeat(length)), { code: 'INVALID_PASSWORD' });
        for (const length of [8, 64]) assert.equal(newPasswordField(character.repeat(length)), character.repeat(length));
    }
    assert.equal(newPasswordField('        '), '        ');
    const app = await start();
    try {
        const created = await app.api('POST', '/admin/accounts', 'admin', { role: 'student', schoolNumber: 'S0099', nickname: '演示同学', name: '虚构同学', password: 'S0099' });
        assert.equal(created.status, 201);
        assert.equal((await login(app, 'S0099', 'S0099')).status, 200);
    } finally { await app.dispose(); }
});

test('creation, reset, password change and login support 64 Unicode characters without truncation', async () => {
    const app = await start();
    const initial = '密'.repeat(64), changedPassword = '😀'.repeat(64);
    try {
        for (const password of ['a'.repeat(65), '😀'.repeat(65)]) {
            const created = await app.api('POST', '/admin/accounts', 'admin', { role: 'student', schoolNumber: 'unicode-limit', password });
            assert.equal(created.status, 400);
            assert.equal(created.data.error.code, 'INVALID_PASSWORD');
            const reset = await app.api('POST', '/admin/accounts/student-a/password', 'admin', { newPassword: password });
            assert.equal(reset.status, 400);
            assert.equal(reset.data.error.code, 'INVALID_PASSWORD');
        }
        assert.equal((await app.api('POST', '/admin/accounts', 'admin', { role: 'student', schoolNumber: 'unicode-limit', password: initial })).status, 201);
        assert.equal((await login(app, initial, 'unicode-limit')).status, 200);
        assert.equal((await app.api('POST', '/admin/accounts/student-a/password', 'admin', { newPassword: initial })).status, 200);
        const loggedIn = await login(app, initial);
        assert.equal(loggedIn.status, 200);
        const auth = cookieOf(loggedIn);
        const tooLong = await request(app, '/auth/password', auth, { oldPassword: initial, newPassword: '😀'.repeat(65) });
        assert.equal(tooLong.status, 400);
        assert.equal((await tooLong.json()).error.code, 'INVALID_PASSWORD');
        assert.equal((await request(app, '/auth/me', auth)).status, 200);
        assert.equal((await request(app, '/auth/password', auth, { oldPassword: initial, newPassword: changedPassword })).status, 200);
        assert.equal((await request(app, '/auth/me', auth)).status, 401);
        assert.equal((await login(app, initial)).status, 401);
        assert.equal((await login(app, '😀'.repeat(63) + '😁')).status, 401);
        assert.equal((await login(app, changedPassword)).status, 200);
    } finally { await app.dispose(); }
});

test('legacy passwords above 64 characters remain usable only for login and old-password verification', async () => {
    const legacyPassword = 'L'.repeat(72);
    // Fixture generated before tightening the password creation limit.
    const legacyHash = 'pbkdf2-sha256$30000$lrM9jfM7NfbZYBSZ5yUJtA==$ju7ggv6X6U8hD5yeXKqtb/62oVMkcpRjYOEF0SP2Tdw=';
    assert.equal(existingPasswordField(legacyPassword), legacyPassword);
    assert.throws(() => existingPasswordField('L'.repeat(73)), { code: 'INVALID_PASSWORD' });
    assert.throws(() => existingPasswordField('密'.repeat(65)), { code: 'INVALID_PASSWORD' });
    assert.throws(() => passwordField(legacyPassword), { code: 'INVALID_PASSWORD' });
    const app = await start();
    try {
        await app.database.prepare("UPDATE accounts SET password=? WHERE id IN ('student-a','admin')").bind(legacyHash).run();
        assert.equal((await request(app, '/auth/admin/login', undefined, { password: legacyPassword })).status, 200);
        const loggedIn = await login(app, legacyPassword);
        assert.equal(loggedIn.status, 200);
        const auth = cookieOf(loggedIn);
        const rejected = await request(app, '/auth/password', auth, { oldPassword: legacyPassword, newPassword: legacyPassword });
        assert.equal(rejected.status, 400);
        assert.equal((await rejected.json()).error.code, 'INVALID_PASSWORD');
        const password = 'N'.repeat(64);
        assert.equal((await request(app, '/auth/password', auth, { oldPassword: legacyPassword, newPassword: password })).status, 200);
        assert.equal((await login(app, legacyPassword)).status, 401);
        assert.equal((await login(app, password)).status, 200);
    } finally { await app.dispose(); }
});