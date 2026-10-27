import assert from 'node:assert/strict';
import { setCurrentTerm } from './discussions-helpers.mjs';
import { before, beforeEach, after, test } from 'node:test';
import { readMigrations } from '../scripts/lib/migrations.mjs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from '../src/index.ts';
import { digest, hashPassword, randomToken } from '../src/auth/crypto.ts';

let runtime, binding, bucket, env, passwordHash;
const password = 'fictional-test-password-123';
const nextPassword = 'fictional-new-password-456';
const fixture = `
PRAGMA defer_foreign_keys=ON;
INSERT INTO accounts (id, nickname, role, name) VALUES
('admin', '管理员', 'admin', NULL), ('teacher', '公开教师', 'teacher', '虚构教师'),
('student', '公开同学', 'student', '虚构甲'), ('other', '其他同学', 'student', '虚构乙'), ('free', '未修读同学', 'student', '虚构丙');
INSERT INTO terms(id,name,current) VALUES ('current','当前学期',0),('past','历史学期',1);
INSERT INTO enrollments(course_id,term_id,account_id) VALUES ('course','past','teacher');
UPDATE terms SET current=0;
UPDATE terms SET current=1 WHERE id='current';
INSERT INTO enrollments(course_id,term_id,account_id) VALUES ('course','current','teacher'),('other-course','current','teacher');
INSERT INTO courses (id, name) VALUES ('course', '当前课程'), ('other-course', '其他课程');
INSERT INTO enrollments (course_id, term_id, account_id) VALUES ('course', 'current', 'student'), ('course', 'past', 'other');
`;

before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21', d1Databases: ['DB'], r2Buckets: ['FILES'],
    }));
    binding = await runtime.getD1Database('DB');
    bucket = await runtime.getR2Bucket('FILES');
    env = { DB: binding, FILES: bucket, APP_ENV: 'local' };
    for (const { statements } of await readMigrations()) {
        await binding.batch(statements.map((sql) => binding.prepare(sql)));
    }
    passwordHash = await hashPassword(password);
});
after(async () => { await runtime?.dispose(); });

beforeEach(async () => {
    await binding.batch(`
PRAGMA defer_foreign_keys=ON;
DELETE FROM courses;
DELETE FROM account_audit;
DELETE FROM sessions;
DELETE FROM login_attempts;
DELETE FROM enrollments WHERE account_id IN (SELECT id FROM accounts WHERE role='student');
DELETE FROM enrollments;
DELETE FROM accounts;
DELETE FROM terms;
`.split(';').filter(s => s.trim()).map(s => binding.prepare(s)));
    await binding.batch(fixture.split(';').filter(sql => sql.trim()).map(sql => binding.prepare(sql)));
    for (const [id, number] of [['admin', null], ['teacher', 'T01'], ['student', '001'], ['other', '002'], ['free', '003']]) {
        await binding.prepare('UPDATE accounts SET school_number = ?, password = ? WHERE id = ?').bind(number, passwordHash, id).run();
    }
    const objects = await bucket.list();
    if (objects.objects.length) await bucket.delete(objects.objects.map((o) => o.key));
});

async function cookie(id) {
    const token = randomToken();
    await binding.prepare('INSERT INTO sessions SELECT ?, id, credential_version, unixepoch() + 3600 FROM accounts WHERE id = ?').bind(await digest(token), id).run();
    return `coursestack_session=${token}`;
}

const call = (path, { method = 'GET', body, cookie, headers = {}, raw } = {}, targetEnv = env) => worker.fetch(new Request(`https://local${path}`, {
    method, headers: { Origin: 'https://local', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
}), targetEnv);
const patch = (id, body, auth) => call(`/api/admin/accounts/${id}`, { method: 'PATCH', body, cookie: auth });
const data = async (response) => (await response.json()).data;
const resetPassword = (id, body, auth, headers) => call(`/api/admin/accounts/${id}/password`, { method: 'POST', body, cookie: auth, headers });
const memberLogin = (schoolNumber, secret) => call('/api/auth/login', { method: 'POST', body: { schoolNumber, password: secret } });

test('account listing is admin-only, paginated and filtered without credentials in responses', async () => {
    assert.equal((await call('/api/admin/accounts')).status, 401);
    assert.equal((await call('/api/admin/accounts', { cookie: await cookie('student') })).status, 403);
    const auth = await cookie('admin');
    const result = await data(await call('/api/admin/accounts?role=student&pageSize=2', { cookie: auth }));
    assert.equal(result.items.length, 2); assert.equal(result.total, 3);
    assert.equal((await data(await call('/api/admin/accounts?q=001', { cookie: auth }))).items[0].id, 'student');
    assert.equal((await call('/api/admin/accounts?pageSize=101', { cookie: auth })).status, 400);
    assert.equal((await call('/api/admin/accounts?role=owner', { cookie: auth })).status, 400);
    assert.equal((await call('/api/admin/accounts/missing', { cookie: auth })).status, 404);
    const responseText = JSON.stringify(result);
    for (const privateCredential of ['passwordHash', 'password_hash', 'token_hash', 'dataGeneration', 'data_generation', 'credential_version', 'revision', 'email', passwordHash]) assert.ok(!responseText.includes(privateCredential));
});

test('disable/restore invalidates old sessions permanently and protects the sole admin', async () => {
    const admin = await cookie('admin'), member = await cookie('student');
    assert.equal((await patch('student', { status: 'disabled' }, admin)).status, 200);
    assert.equal((await call('/api/auth/me', { cookie: member })).status, 401);
    assert.equal((await call('/api/profiles/student')).status, 404);
    assert.equal((await patch('student', { status: 'active' }, admin)).status, 200);
    assert.equal((await call('/api/auth/me', { cookie: member })).status, 401);
    assert.equal((await call('/api/auth/me', { cookie: await cookie('student') })).status, 200);
    for (const field of [{ status: 'disabled' }, { role: 'teacher' }, { schoolNumber: '000' }]) {
        assert.equal((await patch('admin', { ...field }, admin)).status, 403);
    }
});

test('private changes synchronize school numbers and names, revoke sessions and preserve leading zeros', async () => {
    const admin = await cookie('admin'), member = await cookie('student');
    const result = await patch('student', { schoolNumber: ' 0009 ', name: '更正姓名', department: ' 计算机学院 ', major: '软件工程', grade: '2024级' }, admin);
    assert.equal(result.status, 200);
    const profile = await data(result);
    assert.equal(profile.schoolNumber, '0009'); assert.equal(profile.department, '计算机学院'); assert.equal(profile.major, '软件工程'); assert.equal(profile.grade, '2024级'); assert.equal('email' in profile, false);
    assert.deepEqual(await binding.prepare("SELECT school_number, name FROM accounts WHERE id = 'student'").first(), { school_number: '0009', name: '更正姓名' });
    assert.equal((await call('/api/auth/me', { cookie: member })).status, 401);
    const teacherRead = await data(await call('/api/courses/course/students/student/academic-record', { cookie: await cookie('teacher') }));
    assert.equal(teacherRead.name, '更正姓名'); assert.equal(teacherRead.schoolNumber, '0009');
    assert.equal('email' in teacherRead, false);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { schoolNumber: '001', password } })).status, 401);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { schoolNumber: '0009', password } })).status, 200);
});

test('duplicate identifiers roll back all fields and audit records', async () => {
    const admin = await cookie('admin');
    for (const change of [{ schoolNumber: '002' }]) {
        assert.equal((await patch('student', { name: '不应保存', ...change }, admin)).status, 409);
    }
    assert.equal(await binding.prepare("SELECT data_generation FROM accounts WHERE id = 'student'").first('data_generation'), 1);
    assert.equal(await binding.prepare("SELECT name FROM accounts WHERE id = 'student'").first('name'), '虚构甲');
    assert.equal(await binding.prepare('SELECT count(*) AS n FROM account_audit').first('n'), 0);
});

test('role changes retire the old identity, preserve relationships and return a new ID', async () => {
    const admin = await cookie('admin'), oldSession = await cookie('teacher');
    const enrollmentBefore = (await binding.prepare('SELECT * FROM enrollments').all()).results;
    for (const [id, role] of [['teacher', 'student'], ['student', 'teacher'], ['other', 'teacher']]) {
        const response = await patch(id, { role }, admin);
        assert.equal(response.status, 200, await response.clone().text());
        const result = await data(response);
        assert.notEqual(result.id, id); assert.equal(result.previousId, id); assert.equal(result.role, role);
        assert.equal(await binding.prepare('SELECT data_generation FROM accounts WHERE id = ?').bind(id).first('data_generation'), 2);
        assert.deepEqual(await data(await call('/api/profiles/' + id)), { id, nickname: '已删除', avatarUrl: null, isDeleted: true });
        assert.equal((await call('/api/admin/accounts/' + id, { cookie: admin })).status, 404);
        const login = await data(await memberLogin(result.schoolNumber, password));
        assert.equal(login.id, result.id); assert.equal(login.role, role);
        assert.equal(await binding.prepare('SELECT count(*) AS n FROM enrollments WHERE account_id = ?').bind(result.id).first('n'), 0);
    }
    assert.deepEqual((await binding.prepare('SELECT * FROM enrollments').all()).results, enrollmentBefore);
    assert.equal((await call('/api/auth/me', { cookie: oldSession })).status, 401);
    assert.equal((await patch('free', { role: 'admin' }, admin)).status, 400);
});

test('concurrent ordinary edits need no revision and update only submitted fields', async () => {
    const admin = await cookie('admin');
    const results = await Promise.all([{ name: '新姓名' }, { department: '新院系' }].map(body => patch('student', body, admin)));
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    let profile = await data(await call('/api/admin/accounts/student', { cookie: admin }));
    assert.equal(profile.name, '新姓名'); assert.equal(profile.department, '新院系');
    assert.equal((await patch('student', { name: '最后姓名' }, admin)).status, 200);
    profile = await data(await call('/api/admin/accounts/student', { cookie: admin }));
    assert.equal(profile.name, '最后姓名'); assert.equal(profile.department, '新院系');
    const audit = await data(await call('/api/admin/accounts/student/audit', { cookie: admin }));
    assert.equal(audit.total, 3); assert.ok(!JSON.stringify(audit).includes('新姓名'));
    assert.equal(await binding.prepare("SELECT data_generation FROM accounts WHERE id = 'student'").first('data_generation'), 1);
});

test('self editing permits only public fields; public profiles never expose academic/contact identity', async () => {
    const member = await cookie('student');
    const own = await data(await call('/api/me/profile', { cookie: member }));
    assert.equal('email' in own, false); assert.equal(own.name, '虚构甲');
    for (const field of [{ email: 'other@example.test' }, { department: '不允许自行修改' }, { revision: 1 }, { role: 'admin' }, { schoolNumber: '999' }, { name: '越权' }, { status: 'active' }]) {
        assert.equal((await call('/api/me/profile', { method: 'PATCH', cookie: member, body: { nickname: '新名称', ...field } })).status, 400);
    }
    assert.equal((await call('/api/me/profile', { method: 'PATCH', cookie: member, body: { nickname: '新名称' } })).status, 200);
    assert.deepEqual(await data(await call('/api/profiles/student')), { id: 'student', nickname: '新名称', avatarUrl: null, isDeleted: false });
    assert.equal((await call('/api/admin/accounts/student', { cookie: member })).status, 403);
});

test('academic HTTP endpoint enforces current-course/current-term privacy', async () => {
    const teacher = await cookie('teacher');
    assert.equal((await call('/api/courses/course/students/student/academic-record', { cookie: teacher })).status, 200);
    assert.equal((await call('/api/courses/course/students/other/academic-record', { cookie: teacher })).status, 404);
    assert.equal((await call('/api/courses/other-course/students/student/academic-record', { cookie: teacher })).status, 404);
    assert.equal((await call('/api/courses/course/students/student/academic-record', { cookie: await cookie('other') })).status, 404);
    await setCurrentTerm(binding, 'past');
    assert.equal((await call('/api/courses/course/students/student/academic-record', { cookie: teacher })).status, 404);
});

// A 1x1 PNG. No real user images are used.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH7sAAAAASUVORK5CYII=', 'base64');
test('avatar upload/read/delete uses local R2 and enforces type, size and ownership', async () => {
    const member = await cookie('student');
    const upload = (raw, type = 'image/png') => call('/api/me/avatar', { method: 'PUT', cookie: member, raw, headers: { 'Content-Type': type } });
    assert.equal((await upload('<svg></svg>', 'image/svg+xml')).status, 415);
    assert.equal((await upload(png, 'image/jpeg')).status, 415);
    assert.equal((await upload(new Uint8Array(2 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await upload(png)).status, 200);
    assert.equal((await data(await call('/api/profiles/student'))).avatarUrl, '/api/profiles/student/avatar');
    const avatar = await call('/api/profiles/student/avatar');
    assert.equal(avatar.headers.get('content-type'), 'image/png'); assert.equal(avatar.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await avatar.arrayBuffer()), png);
    const concurrent = await Promise.all([upload(png), upload(png)]);
    assert.deepEqual(concurrent.map(r => r.status), [200, 200]);
    assert.equal((await bucket.list({ prefix: 'avatars/' })).objects.length, 1);
    assert.equal((await call('/api/me/avatar', { method: 'DELETE', cookie: member })).status, 200);
    assert.equal((await call('/api/profiles/student/avatar')).status, 404);
    assert.equal((await bucket.list({ prefix: 'avatars/' })).objects.length, 0);
});

test('administrator resets a member password, revoking sessions and clearing that member throttle', async () => {
    const admin = await cookie('admin'), first = await cookie('student'), second = await cookie('student'), other = await cookie('other');
    for (const key of ['member:001', 'password:student', 'member:002']) {
        await binding.prepare('INSERT INTO login_attempts VALUES (?, 99, unixepoch() + 900)').bind(await digest(key)).run();
    }
    const result = await resetPassword('student', { newPassword: nextPassword }, admin);
    assert.equal(result.status, 200);
    assert.equal('revision' in await data(result), false);
    for (const auth of [first, second]) assert.equal((await call('/api/auth/me', { cookie: auth })).status, 401);
    assert.equal((await call('/api/auth/me', { cookie: other })).status, 200);
    assert.equal((await call('/api/auth/me', { cookie: admin })).status, 200);
    assert.equal(await binding.prepare('SELECT count(*) AS n FROM login_attempts').first('n'), 1);
    assert.equal((await memberLogin('001', password)).status, 401);
    assert.equal((await memberLogin('001', nextPassword)).status, 200);
    const audit = await data(await call('/api/admin/accounts/student/audit', { cookie: admin }));
    assert.equal(audit.items[0].action, 'password.reset'); assert.deepEqual(audit.items[0].fields, ['password', 'mustChangePassword']);
    assert.equal(audit.items[0].actorId, 'admin'); assert.ok(!JSON.stringify(audit).includes(nextPassword));
});

test('member password reset is admin-only and same-origin and never targets the administrator', async () => {
    const admin = await cookie('admin');
    const body = { newPassword: nextPassword };
    assert.equal((await resetPassword('student', body)).status, 401);
    assert.equal((await resetPassword('student', body, await cookie('teacher'))).status, 403);
    assert.equal((await resetPassword('student', body, admin, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await call('/api/admin/accounts/student/password', { cookie: admin })).status, 405);
    assert.equal((await resetPassword('admin', body, admin)).status, 403);
    assert.equal((await resetPassword('missing', body, admin)).status, 404);
    assert.equal((await resetPassword('student', { newPassword: null }, admin)).status, 400);
    assert.equal((await resetPassword('student', { ...body, schoolNumber: '999' }, admin)).status, 400);
    assert.equal((await resetPassword('student', { ...body, revision: 2 }, admin)).status, 400);
    const results = await Promise.all([nextPassword, 'fictional-third-password-789'].map((newPassword) => resetPassword('student', { newPassword }, admin)));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200]);
    assert.equal(await binding.prepare("SELECT credential_version FROM accounts WHERE id = 'student'").first('credential_version'), 3);
    assert.equal(await binding.prepare("SELECT count(*) AS n FROM account_audit WHERE action = 'password.reset'").first('n'), 2);
});

test('profile-only changes keep sessions valid and email is no longer an account field', async () => {
    const member = await cookie('student');
    assert.equal((await patch('student', { department: '计算机学院', major: '软件工程', grade: '2024级' }, await cookie('admin'))).status, 200);
    assert.equal((await call('/api/auth/me', { cookie: member })).status, 200);
    for (const path of ['/api/auth/email/verification', '/api/auth/password/forgot']) assert.equal((await call(path, { method: 'POST', body: {} })).status, 404);
});

test('avatar cleanup retries immediately without a registry or deferred job', async () => {
    const member = await cookie('student');
    const request = () => new Request('https://local/api/me/avatar', { method: 'PUT',
        headers: { Origin: 'https://local', Cookie: member, 'Content-Type': 'image/png' }, body: png });
    assert.equal((await worker.fetch(request(), env)).status, 200);
    let attempts = 0;
    const failedDelete = { ...env, FILES: { put: bucket.put.bind(bucket), delete: async key => {
        if (++attempts < 3) throw new Error('temporary R2 failure');
        await bucket.delete(key);
    } } };
    assert.equal((await worker.fetch(request(), failedDelete)).status, 200);
    assert.equal(attempts, 3);
    assert.equal((await bucket.list({ prefix: 'avatars/' })).objects.length, 1);
    assert.equal((await call('/api/profiles/student/avatar')).status, 200);
});

test('revoked administrator sessions cannot mutate accounts or reset passwords', async () => {
    const admin = await cookie('admin');
    await binding.prepare("DELETE FROM sessions WHERE account_id = 'admin'").run();
    assert.equal((await patch('student', { name: '越权修改' }, admin)).status, 401);
    assert.equal((await resetPassword('student', { newPassword: nextPassword }, admin)).status, 401);
    assert.equal((await memberLogin('001', password)).status, 200);
});

test('deletion is admin-only, same-origin and protects the administrator', async () => {
    const admin = await cookie('admin');
    assert.equal((await call('/api/admin/accounts/student', { method: 'DELETE' })).status, 401);
    assert.equal((await call('/api/admin/accounts/student', { method: 'DELETE', cookie: await cookie('teacher') })).status, 403);
    assert.equal((await call('/api/admin/accounts/student', { method: 'DELETE', cookie: admin, headers: { Origin: 'https://other.test' } })).status, 403);
    assert.equal((await call('/api/admin/accounts/admin', { method: 'DELETE', cookie: admin })).status, 403);
});

test('avatar work is attached to waitUntil and retirement cleans an upload awaiting its database write', async () => {
    const member = await cookie('student'), admin = await cookie('admin'), background = [];
    const target = { ...env, FILES: { ...bucket, put: async (...args) => {
        const object = await bucket.put(...args);
        assert.equal((await call('/api/admin/accounts/student', { method: 'DELETE', cookie: admin })).status, 200);
        return object;
    }, delete: bucket.delete.bind(bucket) } };
    const response = await worker.fetch(new Request('https://local/api/me/avatar', { method: 'PUT',
        headers: { Origin: 'https://local', Cookie: member, 'Content-Type': 'image/png' }, body: png }), target,
        { waitUntil(promise) { background.push(promise); }, passThroughOnException() {} });
    assert.equal(response.status, 409); assert.equal(background.length, 1);
    await Promise.all(background);
    assert.equal((await bucket.list()).objects.length, 0);
    assert.equal(await binding.prepare("SELECT avatar_key FROM accounts WHERE id='student'").first('avatar_key'), null);
});

test('failed role replacement rolls back the new account, old login and audit', async () => {
    const admin = await cookie('admin'), member = await cookie('student');
    const before = (await binding.prepare('SELECT * FROM accounts ORDER BY id').all()).results;
    const response = await patch('student', { role: 'teacher', schoolNumber: '002' }, admin);
    assert.equal(response.status, 409);
    assert.deepEqual((await binding.prepare('SELECT * FROM accounts ORDER BY id').all()).results, before);
    assert.equal(await binding.prepare('SELECT count(*) AS n FROM account_audit').first('n'), 0);
    assert.equal((await call('/api/auth/me', { cookie: member })).status, 200);
});

test('an admitted academic read survives disable, while subsequent requests are denied', async () => {
    const teacher = await cookie('teacher');
    let intercepted = false;
    const wrap = (statement, sql) => new Proxy(statement, { get(target, key) {
        if (key === 'bind') return (...values) => wrap(target.bind(...values), sql);
        if (['first', 'all', 'raw'].includes(key)) return async (...args) => {
            if (!intercepted && sql.includes('inner join "enrollments"')) {
                intercepted = true;
                await binding.prepare("UPDATE accounts SET status='disabled',credential_version=credential_version+1 WHERE id='teacher'").run();
                await binding.prepare("DELETE FROM sessions WHERE account_id='teacher'").run();
            }
            return target[key](...args);
        };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const delayed = { ...env, DB: { prepare(sql) { return wrap(binding.prepare(sql), sql); } } };
    const result = await call('/api/courses/course/students/student/academic-record', { cookie: teacher }, delayed);
    assert.equal(intercepted, true); assert.equal(result.status, 200);
    assert.equal((await data(result)).name, '虚构甲');
    assert.equal((await call('/api/courses/course/students/student/academic-record', { cookie: teacher })).status, 401);
});