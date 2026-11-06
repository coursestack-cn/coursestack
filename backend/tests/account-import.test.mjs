import assert from 'node:assert/strict';
import { test } from 'node:test';
import { start } from './discussions-helpers.mjs';
import { verifyPassword } from '../src/auth/crypto.ts';
import { createMember } from '../src/accounts/creation.ts';

const values = extra => ({ role: 'student', schoolNumber: '00123', name: '', department: '', major: '', grade: '', nickname: '', password: '', ...extra });
const row = (line, extra) => ({ line, values: values(extra) });
const body = extra => ({ ...values(), password: 'fictional-temporary-secret', mustChangePassword: true, ...extra });
async function setup(t) { const h = await start(); t.after(() => h.dispose()); return h; }
const create = (h, data, key = crypto.randomUUID()) => h.api('POST', '/admin/accounts', 'admin', data, { key });
const preview = (h, rows, actor = 'admin') => h.api('POST', '/admin/accounts/import/preview', actor, { rows });
const count = (h, number) => h.database.prepare('SELECT COUNT(*) AS n FROM accounts WHERE school_number=?').bind(number).first('n');

test('account preview is administrator-only, same-origin and read-only', async t => {
    const h = await setup(t), rows = [row(2)];
    assert.equal((await preview(h, rows, null)).status, 401);
    assert.equal((await preview(h, rows, 'teacher-a')).status, 403);
    assert.equal((await preview(h, rows, 'student-a')).status, 403);
    assert.equal((await h.api('POST', '/admin/accounts/import/preview', 'admin', { rows }, { headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await h.api('POST', '/admin/accounts/import/preview', 'admin', { rows }, { headers: { 'X-Expected-Account': 'student-a' } })).status, 409);
    assert.equal((await preview(h, rows)).data.items[0].status, 'ready');
    assert.equal(await count(h, '00123'), 0);
    assert.equal((await h.api('POST', '/admin/accounts', 'teacher-a', body())).status, 403);
});

test('preview classifies existing, disabled, exact duplicate and conflicting rows independently', async t => {
    const h = await setup(t);
    await h.database.prepare("UPDATE accounts SET status='disabled' WHERE id='visitor'").run();
    const rows = [row(2, { role: '学生', schoolNumber: ' 00123 ', password: 'private-preview-password' }),
        row(3, { schoolNumber: '00123', password: 'private-preview-password' }), row(4, { schoolNumber: 'student-a' }),
        row(5, { schoolNumber: 'visitor' }), row(6, { schoolNumber: 'teacher-a' }),
        row(7, { schoolNumber: 'conflict', name: '甲' }), row(8, { schoolNumber: 'conflict', name: '乙' }),
        row(9, { schoolNumber: '', role: 'admin' }), row(10, { name: 'x'.repeat(81), schoolNumber: 'bad-name' })];
    const response = await preview(h, rows);
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.items.map(r => r.status), ['ready', 'duplicate', 'existing', 'existing', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid']);
    assert.ok(!JSON.stringify(response.payload).includes('private-preview-password'));
    assert.equal(await count(h, '00123'), 0);
});

test('preview validates request shape and supports 500 items without SQL parameter overflow', async t => {
    const h = await setup(t), rows = Array.from({ length: 500 }, (_, i) => row(i + 2, { schoolNumber: `000${i}` }));
    const result = await preview(h, rows);
    assert.equal(result.status, 200); assert.equal(result.data.items.length, 500);
    assert.ok(result.data.items.every(item => item.status === 'ready'));
    for (const invalid of [[], [...rows, row(502)], [row(2), row(2)], [{ line: 2, values: { role: 'student' } }]]) {
        assert.equal((await preview(h, invalid)).status, 400);
    }
    assert.equal((await preview(h, [row(2, { name: 'x'.repeat(2 * 1024 * 1024) })])).status, 413);
});

test('account creation preserves profile privacy, temporary-password rules and the original single-account API', async t => {
    const h = await setup(t);
    const response = await create(h, body({ schoolNumber: ' 00099 ', name: ' 虚构甲 ', nickname: ' ', department: ' 示例学院 ', password: ' a ' }));
    assert.equal(response.status, 201, JSON.stringify(response.data));
    assert.equal(response.data.schoolNumber, '00099'); assert.equal(response.data.name, '虚构甲');
    assert.equal(response.data.nickname, null); assert.equal(response.data.department, '示例学院');
    assert.equal(response.data.mustChangePassword, true); assert.ok(!Object.hasOwn(response.data, 'password'));
    const account = await h.database.prepare('SELECT * FROM accounts WHERE id=?').bind(response.data.id).first();
    assert.ok(await verifyPassword(' a ', account.password)); assert.ok(!await verifyPassword('a', account.password));
    const login = await h.api('POST', '/auth/login', null, { schoolNumber: '00099', password: ' a ' });
    assert.equal(login.status, 200); assert.equal(login.data.mustChangePassword, true);
    const restricted = await h.worker.fetch('http://localhost/api/teaching-classes', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
    assert.equal(restricted.status, 403);
    const oldApi = await h.worker.fetch('http://localhost/api/admin/accounts', { method: 'POST', headers: {
        Origin: 'http://localhost', 'Content-Type': 'application/json', Cookie: `coursestack_session=${Buffer.from('admin').toString('hex').padEnd(64, '0')}`,
    }, body: JSON.stringify({ role: 'teacher', schoolNumber: 'T-old-api', password: 'x' }) });
    assert.equal(oldApi.status, 201); assert.equal((await oldApi.json()).data.mustChangePassword, false);
    for (const extra of [{ role: 'admin' }, { password: '' }, { password: '😀'.repeat(65) }, { mustChangePassword: 'true' }, { name: 'x'.repeat(81) }]) {
        assert.equal((await create(h, body({ schoolNumber: crypto.randomUUID(), ...extra }))).status, 400);
    }
});

test('stable request keys recover the original ID, reject changed inputs, and store no plaintext or fast password hash', async t => {
    const h = await setup(t), data = body(), key = crypto.randomUUID();
    const first = await create(h, data, key), retry = await create(h, data, key);
    assert.equal(first.status, 201); assert.equal(retry.status, 201); assert.equal(first.data.id, retry.data.id);
    assert.equal(await count(h, data.schoolNumber), 1);
    for (const change of [{ schoolNumber: 'changed' }, { name: 'different' }, { password: 'different' }, { mustChangePassword: false }]) {
        const conflict = await create(h, { ...data, ...change }, key);
        assert.equal(conflict.status, 409); assert.equal(conflict.data.error.code, 'IDEMPOTENCY_CONFLICT');
    }
    assert.equal(await count(h, 'changed'), 0);
    const record = await h.database.prepare('SELECT * FROM account_creation_requests WHERE request_key=?').bind(key).first();
    assert.deepEqual(Object.keys(record).sort(), ['account_id', 'actor_id', 'created_at', 'request_hash', 'request_key']);
    assert.ok(!JSON.stringify(record).includes(data.password));
    assert.equal((await create(h, data)).data.error.code, 'SCHOOL_NUMBER_EXISTS');
    assert.equal((await create(h, body({ schoolNumber: 'student-a' }))).data.error.code, 'SCHOOL_NUMBER_EXISTS');
    assert.equal((await create(h, body({ schoolNumber: 'teacher-a' }))).data.error.code, 'SCHOOL_NUMBER_EXISTS');
    assert.equal((await create(h, data, 'bad')).status, 400);
});

test('concurrent retries and competing creations create at most one account', async t => {
    const h = await setup(t), key = crypto.randomUUID(), data = body();
    const same = await Promise.all([create(h, data, key), create(h, data, key)]);
    assert.deepEqual(same.map(r => r.status), [201, 201]); assert.equal(same[0].data.id, same[1].data.id);
    const reusedKey = crypto.randomUUID();
    const changed = await Promise.all([create(h, body({ schoolNumber: 'parallel-a' }), reusedKey), create(h, body({ schoolNumber: 'parallel-b' }), reusedKey)]);
    assert.deepEqual(changed.map(r => r.status).sort(), [201, 409]);
    assert.equal(await count(h, 'parallel-a') + await count(h, 'parallel-b'), 1);
    const competing = await Promise.all([create(h, body({ schoolNumber: 'same-number' })), create(h, body({ schoolNumber: 'same-number' }))]);
    assert.deepEqual(competing.map(r => r.status).sort(), [201, 409]); assert.equal(await count(h, 'same-number'), 1);
});

test('retries never reset credentials or resurrect deleted identities; school-number reuse gets a fresh ID', async t => {
    const h = await setup(t), key = crypto.randomUUID(), data = body();
    const created = await create(h, data, key);
    const reset = await h.api('POST', `/admin/accounts/${created.data.id}/password`, 'admin', { newPassword: 'new-fictional-password', mustChangePassword: true });
    assert.equal(reset.status, 200);
    assert.equal((await create(h, data, key)).data.error.code, 'CREATED_ACCOUNT_CHANGED');
    assert.ok(await verifyPassword('new-fictional-password', await h.database.prepare('SELECT password FROM accounts WHERE id=?').bind(created.data.id).first('password')));
    assert.equal((await h.api('DELETE', `/admin/accounts/${created.data.id}`, 'admin')).status, 200);
    assert.equal((await create(h, data, key)).data.error.code, 'CREATED_ACCOUNT_CHANGED');
    const replacement = await create(h, data);
    assert.equal(replacement.status, 201); assert.notEqual(replacement.data.id, created.data.id);
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM class_students WHERE student_id=?').bind(replacement.data.id).first('n'), 0);
});

test('request records and account creation are atomic, and retired actors cannot write', async t => {
    const h = await setup(t);
    await h.database.prepare("CREATE TRIGGER fail_test_request BEFORE INSERT ON account_creation_requests BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
    assert.equal((await create(h, body())).status, 500);
    assert.equal(await count(h, '00123'), 0);
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM account_creation_requests').first('n'), 0);
    await h.database.prepare('DROP TRIGGER fail_test_request').run();
    await assert.rejects(createMember(h.database, { id: 'nonexistent-actor', role: 'admin' }, body(), crypto.randomUUID()), error => error.code === 'ACCOUNT_DELETED');
    assert.equal(await count(h, '00123'), 0);
});