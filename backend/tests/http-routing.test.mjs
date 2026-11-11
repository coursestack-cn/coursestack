import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.ts';

const origin = 'https://local';
const call = (method, path, init = {}, env = {}) => worker.fetch(new Request(origin + path, { method, ...init }), env);

test('known paths reject unsupported methods before checking credentials, body or Origin', async () => {
    for (const [method, path, allowed] of [
        ['POST', '/api/search?q=test', ['GET', 'HEAD']],
        ['PUT', '/api/courses', ['GET', 'POST', 'HEAD']],
        ['POST', '/api/courses/C%2F1', ['GET', 'PATCH', 'HEAD']],
        ['PATCH', '/api/materials/material-a/versions/1/preview', ['GET', 'HEAD']],
        ['PATCH', '/api/internal/documents', ['GET', 'HEAD']],
        ['GET', '/api/admin/accounts/import/preview', ['POST']],
        ['PUT', '/api/admin/accounts', ['GET', 'POST', 'HEAD']],
        ['POST', '/api/admin/accounts/a', ['GET', 'PATCH', 'DELETE', 'HEAD']],
        ['GET', '/api/admin/accounts/a/password', ['POST']],
        ['PATCH', '/api/profiles/a/avatar', ['GET', 'HEAD']],
        ['GET', '/api/auth/login', ['POST']],
        ['POST', '/api/health', ['GET']],
    ]) {
        const response = await call(method, path, { headers: { Origin: 'https://other.invalid', Cookie: 'coursestack_session=' + 'a'.repeat(64) } });
        assert.equal(response.status, 405, method + ' ' + path);
        assert.deepEqual(response.headers.get('Allow')?.split(', ').sort(), allowed.sort(), path);
        assert.ok(response.headers.get('X-Request-Id'));
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED');
    }
    const unknown = await call('POST', '/api/auth/not-a-route', { headers: { Origin: origin } });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get('Allow'), null);
    assert.equal((await unknown.json()).error.code, 'NOT_FOUND');
});

test('valid methods retain their original auth, HEAD, Origin, JSON and size rules', async () => {
    assert.equal((await call('GET', '/api/search')).status, 200);
    const head = await call('HEAD', '/api/search');
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    // Session routes are ordinary Hono routes: HEAD runs the GET handler and its checks without a body.
    const sessionHead = await call('HEAD', '/api/auth/me');
    assert.equal(sessionHead.status, 401);
    assert.equal(await sessionHead.text(), '');
    assert.equal((await call('GET', '/api/me/profile')).status, 401);
    assert.equal((await call('POST', '/api/admin/accounts/import/preview', { headers: { Origin: origin } })).status, 401);
    for (const path of ['/api/auth/login', '/api/courses']) {
        const response = await call('POST', path, { headers: { Origin: 'https://other.invalid' } });
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error.code, 'ORIGIN_DENIED');
    }
    for (const [body, status, code] of [['{', 400, 'INVALID_INPUT'], ['x'.repeat(8193), 413, 'BODY_TOO_LARGE']]) {
        const response = await call('POST', '/api/auth/login', { headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
        assert.equal(response.status, status);
        assert.equal((await response.json()).error.code, code);
    }
    const logout = await call('POST', '/api/auth/logout', { headers: { Origin: origin } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.deepEqual(await logout.json(), { data: { loggedOut: true } });
});

test('unknown failures log the request ID, route template and bounded safe causes', async t => {
    const logs = [];
    t.mock.method(console, 'error', entry => logs.push(entry));
    const secret = 'private-test-marker';
    const nested = Object.assign(new TypeError('https://files.invalid/?signature=' + secret), { code: 'ECONNRESET' });
    const error = Object.assign(new Error('password=' + secret, { cause: nested }), { name: secret, code: secret });
    nested.cause = error;
    const env = { DB: { prepare() { throw error; } } };
    for (const [method, path, template] of [
        ['GET', `/api/profiles/${secret}/avatar`, '/api/profiles/:id/avatar'],
        ['GET', `/api/courses/${secret}`, '/api/courses/:id'],
        ['POST', '/api/auth/login', '/api/auth/login'],
    ]) {
        const response = await call(method, path + '?signature=' + secret, {
            headers: { Cookie: 'session=' + secret, Origin: origin, 'Content-Type': 'application/json' },
            ...(method === 'POST' ? { body: JSON.stringify({ schoolNumber: secret, password: secret }) } : {}),
        }, env);
        assert.equal(response.status, 500);
        assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
        const entry = logs.at(-1);
        assert.equal(entry.path, template);
        assert.ok(entry.requestId);
        assert.equal(entry.requestId, response.headers.get('X-Request-Id'));
        assert.ok(entry.errors.length <= 5);
        assert.deepEqual(entry.errors.slice(-2), [{ name: 'UnknownError' }, { name: 'TypeError', code: 'ECONNRESET' }]);
        assert.ok(!JSON.stringify(entry).includes(secret));
    }
    const mapped = await call('GET', '/api/profiles/a/avatar', {}, { DB: { prepare() { throw new Error('UNIQUE constraint failed: ' + secret); } } });
    assert.equal(mapped.status, 409);
    assert.equal((await mapped.json()).error.code, 'DUPLICATE_RECORD');
    assert.equal(logs.length, 3);
});