import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../src/db/index.ts';
import { accounts, academicSettings, teachingAssignments } from '../src/db/schema.ts';
import { getPublicProfile, getStudentRecordForAdministrator, getStudentRecordForTeacher, isAdministrator, isCurrentCourseTeacher } from '../src/permissions.ts';
import worker from '../src/index.ts';
import { initializeAdministrator } from '../src/auth/service.ts';
import { digest, passwordField } from '../src/auth/crypto.ts';

let runtime;
let binding;
let db;
const fixture = `
INSERT INTO accounts (id, public_name) VALUES ('admin', '管理用户'), ('teacher', '公开教师'), ('other-teacher', '其他教师'), ('student', '公开同学'), ('history', '历年同学'), ('outsider', '其他同学');
INSERT INTO account_roles (account_id, role) VALUES ('admin', 'admin'), ('teacher', 'teacher'), ('other-teacher', 'teacher'), ('student', 'student'), ('history', 'student'), ('outsider', 'student');
INSERT INTO student_records (account_id, student_number, real_name) VALUES ('student', 'TEST-001', '虚构甲'), ('history', 'TEST-002', '虚构乙'), ('outsider', 'TEST-003', '虚构丙');
INSERT INTO courses (id, name) VALUES ('course', '课程甲'), ('other-course', '课程乙');
INSERT INTO terms (id, name) VALUES ('current', '当前学期'), ('previous', '历年学期'), ('next', '下个学期');
UPDATE academic_settings SET current_term_id = 'current' WHERE id = 1;
INSERT INTO teaching_assignments (course_id, term_id, teacher_id) VALUES ('course', 'current', 'teacher'), ('course', 'previous', 'other-teacher'), ('other-course', 'current', 'other-teacher');
INSERT INTO enrollments (course_id, term_id, student_id) VALUES ('course', 'current', 'student'), ('course', 'previous', 'history'), ('other-course', 'current', 'outsider');
`;

before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21',
        d1Databases: ['DB'],
    }));
    binding = await runtime.getD1Database('DB');
    const migrations = await readdir(new URL('../migrations/', import.meta.url));
    for (const name of migrations.filter((name) => name.endsWith('.sql')).sort()) {
        const source = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
        await binding.batch(source.split('-- statement-breakpoint').filter((s) => s.trim()).map((s) => binding.prepare(s)));
    }
    db = createDatabase(binding);
});

after(async () => { await runtime?.dispose(); });

beforeEach(async () => {
    // Delete only isolated in-memory test data, in foreign-key dependency order.
    await binding.exec(`
DELETE FROM sessions;
DELETE FROM avatar_objects;
DELETE FROM account_audit;
DELETE FROM account_private;
DELETE FROM credentials;
DELETE FROM login_attempts;
DELETE FROM enrollments;
DELETE FROM teaching_assignments;
DELETE FROM student_records;
DELETE FROM account_roles;
DELETE FROM accounts;
UPDATE academic_settings SET current_term_id = NULL;
DELETE FROM terms;
DELETE FROM courses;
`);
    await binding.exec(fixture);
});

test('public profile is a field allowlist and never includes academic identity', async () => {
    assert.deepEqual(await getPublicProfile(db, 'student'), { id: 'student', publicName: '公开同学', avatarUrl: null });
    assert.equal(await getPublicProfile(db, 'missing'), null);
    await db.update(accounts).set({ status: 'disabled' }).where(eq(accounts.id, 'student'));
    assert.equal(await getPublicProfile(db, 'student'), null);
});

test('only active administrator accounts have global academic access', async () => {
    assert.equal(await isAdministrator(db, 'admin'), true);
    assert.deepEqual(await getStudentRecordForAdministrator(db, 'admin', 'outsider'), {
        accountId: 'outsider', studentNumber: 'TEST-003', realName: '虚构丙',
    });
    for (const actor of [null, 'missing', 'teacher', 'student']) {
        assert.equal(await isAdministrator(db, actor), false);
        assert.equal(await getStudentRecordForAdministrator(db, actor, 'student'), null);
    }
    await db.update(accounts).set({ status: 'disabled' }).where(eq(accounts.id, 'admin'));
    assert.equal(await isAdministrator(db, 'admin'), false);
    assert.equal(await getStudentRecordForAdministrator(db, 'admin', 'student'), null);
});

test('academic access requires both current teaching and current enrollment in the same course', async () => {
    assert.equal(await isCurrentCourseTeacher(db, 'teacher', 'course'), true);
    assert.deepEqual(await getStudentRecordForTeacher(db, 'teacher', 'course', 'student'), {
        accountId: 'student', studentNumber: 'TEST-001', realName: '虚构甲',
    });
    for (const actor of [null, 'missing', 'student', 'history', 'other-teacher', 'admin']) {
        assert.equal(await isCurrentCourseTeacher(db, actor, 'course'), false);
        assert.equal(await getStudentRecordForTeacher(db, actor, 'course', 'student'), null);
    }
    for (const student of ['history', 'outsider', 'missing']) {
        assert.equal(await getStudentRecordForTeacher(db, 'teacher', 'course', student), null);
    }
    assert.equal(await getStudentRecordForTeacher(db, 'teacher', 'other-course', 'outsider'), null);
});

test('disabling a teacher or revoking teaching immediately removes access', async () => {
    await db.update(accounts).set({ status: 'disabled' }).where(eq(accounts.id, 'teacher'));
    assert.equal(await isCurrentCourseTeacher(db, 'teacher', 'course'), false);
    assert.equal(await getStudentRecordForTeacher(db, 'teacher', 'course', 'student'), null);
    await db.update(accounts).set({ status: 'active' }).where(eq(accounts.id, 'teacher'));
    await db.delete(teachingAssignments).where(eq(teachingAssignments.teacherId, 'teacher'));
    assert.equal(await getStudentRecordForTeacher(db, 'teacher', 'course', 'student'), null);
});

test('term changes remove old access without deleting history; no term grants nothing', async () => {
    await db.update(academicSettings).set({ currentTermId: 'next' }).where(eq(academicSettings.id, 1));
    assert.equal(await isCurrentCourseTeacher(db, 'teacher', 'course'), false);
    assert.equal(await getStudentRecordForTeacher(db, 'teacher', 'course', 'student'), null);
    const count = await binding.prepare('SELECT COUNT(*) AS count FROM enrollments').first('count');
    assert.equal(count, 3);
    await binding.prepare("INSERT INTO teaching_assignments (course_id, term_id, teacher_id) VALUES ('course', 'next', 'teacher')").run();
    assert.equal(await isCurrentCourseTeacher(db, 'teacher', 'course'), true);
    assert.equal(await getStudentRecordForTeacher(db, 'teacher', 'course', 'student'), null);
    await binding.prepare("INSERT INTO enrollments (course_id, term_id, student_id) VALUES ('course', 'next', 'student')").run();
    assert.ok(await getStudentRecordForTeacher(db, 'teacher', 'course', 'student'));
    await db.update(academicSettings).set({ currentTermId: null }).where(eq(academicSettings.id, 1));
    assert.equal(await getStudentRecordForTeacher(db, 'teacher', 'course', 'student'), null);
});

test('foreign keys and checks reject wrong identities, orphan relations and duplicate enrollment', async () => {
    const invalid = [
        "INSERT INTO account_roles VALUES ('missing', 'teacher')",
        "INSERT INTO account_roles VALUES ('teacher', 'root')",
        "INSERT INTO student_records (account_id, student_number, real_name) VALUES ('teacher', 'TEST-004', '虚构丁')",
        "INSERT INTO teaching_assignments (course_id, term_id, teacher_id) VALUES ('course', 'current', 'student')",
        "INSERT INTO enrollments (course_id, term_id, student_id) VALUES ('course', 'current', 'teacher')",
        "INSERT INTO enrollments (course_id, term_id, student_id, role) VALUES ('course', 'current', 'teacher', 'teacher')",
        "INSERT INTO enrollments (course_id, term_id, student_id) VALUES ('missing', 'current', 'student')",
        "INSERT INTO enrollments (course_id, term_id, student_id) VALUES ('course', 'missing', 'student')",
        "INSERT INTO enrollments (course_id, term_id, student_id) VALUES ('course', 'current', 'student')",
        "UPDATE student_records SET student_number = 'TEST-001' WHERE account_id = 'history'",
        "UPDATE accounts SET status = 'unknown' WHERE id = 'student'",
        "UPDATE accounts SET public_name = '   ' WHERE id = 'student'",
        "INSERT INTO academic_settings (id) VALUES (2)",
        "DELETE FROM account_roles WHERE account_id = 'teacher'",
        "DELETE FROM courses WHERE id = 'course'",
    ];
    for (const sql of invalid) {
        await assert.rejects(binding.prepare(sql).run(), /constraint/i, sql);
    }
    // Multiple teachers for one course are valid.
    await binding.prepare("INSERT INTO teaching_assignments (course_id, term_id, teacher_id) VALUES ('course', 'current', 'other-teacher')").run();
    assert.ok(await getStudentRecordForTeacher(db, 'other-teacher', 'course', 'student'));
});

test('D1 batches roll back all writes when a membership constraint fails', async () => {
    await assert.rejects(binding.batch([
        binding.prepare("INSERT INTO accounts (id, public_name) VALUES ('rollback', '回滚用户')"),
        binding.prepare("INSERT INTO enrollments (course_id, term_id, student_id) VALUES ('course', 'current', 'rollback')"),
    ]));
    assert.equal(await binding.prepare("SELECT id FROM accounts WHERE id = 'rollback'").first(), null);
});

test('local seeds are repeatable and preserve later edits and term selection', async () => {
    const seed = await readFile(new URL('../seed/local.sql', import.meta.url), 'utf8');
    const apply = () => binding.batch(seed.split(';').filter((s) => s.trim()).map((s) => binding.prepare(s)));
    await apply();
    await binding.prepare("UPDATE accounts SET public_name = '修改后的名称' WHERE id = 'demo-student'").run();
    await apply();
    assert.equal((await getPublicProfile(db, 'demo-student')).publicName, '修改后的名称');
    assert.equal(await binding.prepare('SELECT current_term_id FROM academic_settings').first('current_term_id'), 'current');
    assert.equal(await binding.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE student_id = 'demo-student'").first('n'), 1);
});

test('HTTP handles health, unknown routes, methods and database errors', async () => {
    const env = { DB: binding, APP_ENV: 'local' };
    const health = await worker.fetch(new Request('http://local/api/health'), env);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await health.json(), { data: { status: 'ok', environment: 'local', database: 'ok' } });
    const post = await worker.fetch(new Request('http://local/api/health', { method: 'POST' }), env);
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('Allow'), 'GET');
    for (const path of ['/api/register', '/api/login', '/api/students/student']) {
        assert.equal((await worker.fetch(new Request(`http://local${path}`), env)).status, 404);
    }
    const unavailable = await worker.fetch(new Request('http://local/api/health'), {
        ...env, DB: { prepare() { throw new Error('private database details'); } },
    });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂时不可用' } });
});

// Fictional test passwords, only used in isolated ephemeral D1 instances.
const testPassword = 'test-only-password-123';
const nextPassword = 'test-only-new-password-456';
const call = (path, body, cookie, method = 'POST', origin = 'https://local') => worker.fetch(new Request(`https://local${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), { DB: binding, APP_ENV: 'local' });
const cookieOf = (response) => response.headers.get('set-cookie')?.split(';')[0];

async function adminCookie() {
    await initializeAdministrator(binding, testPassword);
    const response = await call('/api/auth/admin/login', { password: testPassword });
    assert.equal(response.status, 200);
    return cookieOf(response);
}

test('administrator is unique, password-only, and initialization never overwrites it', async () => {
    const cookie = await adminCookie();
    assert.ok(cookie);
    await assert.rejects(initializeAdministrator(binding, nextPassword), (error) => error.code === 'ADMIN_EXISTS');
    await assert.rejects(binding.prepare("INSERT INTO account_roles VALUES ('teacher', 'admin')").run(), /UNIQUE/);
    const adminCredential = await binding.prepare("SELECT * FROM credentials WHERE account_id = 'admin'").first();
    assert.equal(adminCredential.school_number, null);
    assert.notEqual(adminCredential.password_hash, testPassword);
    const profile = await call('/api/auth/me', undefined, cookie, 'GET');
    assert.deepEqual(await profile.json(), { data: { id: 'admin', publicName: '管理用户', roles: ['admin'] } });
    const wrong = await call('/api/auth/admin/login', { password: nextPassword });
    assert.equal(wrong.status, 401);
    assert.equal((await call('/api/auth/login', { schoolNumber: 'admin', password: testPassword })).status, 401);
});

test('administrator can create students and teachers; duplicate school numbers roll back the entire account', async () => {
    const cookie = await adminCookie();
    const body = { role: 'student', schoolNumber: 'NEW-001', publicName: '新同学', realName: '虚构新同学', password: testPassword };
    const created = await call('/api/admin/accounts', body, cookie);
    assert.equal(created.status, 201);
    const { data } = await created.json();
    assert.deepEqual(await getPublicProfile(db, data.id), { id: data.id, publicName: '新同学', avatarUrl: null });
    assert.equal((await call('/api/admin/accounts', body, cookie)).status, 409);
    assert.equal(await binding.prepare("SELECT COUNT(*) AS n FROM accounts WHERE public_name = '新同学'").first('n'), 1);
    assert.equal((await call('/api/admin/accounts', { ...body, role: 'admin' }, cookie)).status, 400);
    assert.equal((await call('/api/admin/accounts', { ...body, role: 'teacher', schoolNumber: 'NEW-002' }, cookie)).status, 201);
    const member = await call('/api/auth/login', { schoolNumber: 'NEW-001', password: testPassword });
    assert.equal(member.status, 200);
    assert.deepEqual((await member.json()).data, { id: data.id, publicName: '新同学', roles: ['student'] });
    // No first-login password gate: the initial credential immediately yields a working session.
    assert.equal((await call('/api/auth/me', undefined, cookieOf(member), 'GET')).status, 200);
    assert.equal((await call('/api/admin/accounts', { ...body, schoolNumber: 'NEW-003' }, cookieOf(member))).status, 403);
    assert.equal((await call('/api/auth/login', { schoolNumber: 'NEW-002', password: testPassword })).status, 200);
    assert.equal((await call('/api/auth/admin/login', { password: 'incorrect-password-123' })).status, 401);
});

test('session cookies are protected, only digests are stored, and logout revokes the token', async () => {
    await initializeAdministrator(binding, testPassword);
    const response = await call('/api/auth/admin/login', { password: testPassword });
    const header = response.headers.get('set-cookie');
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=604800']) assert.ok(header.includes(part));
    const cookie = cookieOf(response);
    const token = cookie.split('=')[1];
    const session = await binding.prepare('SELECT * FROM sessions').first();
    assert.equal(session.token_hash, await digest(token));
    assert.notEqual(session.token_hash, token);
    assert.equal((await call('/api/auth/me', undefined, 'coursestack_session=forged', 'GET')).status, 401);
    assert.equal((await call('/api/auth/logout', undefined, cookie)).status, 200);
    assert.equal((await call('/api/auth/me', undefined, cookie, 'GET')).status, 401);
    assert.equal((await call('/api/auth/logout', undefined, cookie)).status, 200);
});

test('password changes require the old password and invalidate all prior sessions', async () => {
    const first = await adminCookie();
    const second = cookieOf(await call('/api/auth/admin/login', { password: testPassword }));
    const wrong = await call('/api/auth/password', { oldPassword: nextPassword, newPassword: nextPassword }, first);
    assert.equal(wrong.status, 401);
    const changed = await call('/api/auth/password', { oldPassword: testPassword, newPassword: nextPassword }, first);
    assert.equal(changed.status, 200);
    for (const cookie of [first, second]) assert.equal((await call('/api/auth/me', undefined, cookie, 'GET')).status, 401);
    assert.equal((await call('/api/auth/admin/login', { password: testPassword })).status, 401);
    assert.equal((await call('/api/auth/admin/login', { password: nextPassword })).status, 200);
});

test('expired sessions and disabled accounts cannot access authenticated APIs', async () => {
    const cookie = await adminCookie();
    await binding.prepare("UPDATE accounts SET status = 'disabled' WHERE id = 'admin'").run();
    assert.equal((await call('/api/auth/me', undefined, cookie, 'GET')).status, 401);
    assert.equal((await call('/api/auth/admin/login', { password: testPassword })).status, 401);
    await binding.prepare("UPDATE accounts SET status = 'active' WHERE id = 'admin'").run();
    await binding.prepare('UPDATE sessions SET expires_at = unixepoch() - 1').run();
    assert.equal((await call('/api/auth/me', undefined, cookie, 'GET')).status, 401);
});

test('CSRF, forged identities, malformed and oversized requests are rejected', async () => {
    assert.equal((await call('/api/auth/admin/login', { password: testPassword }, undefined, 'POST', 'https://evil.example')).status, 403);
    assert.equal((await call('/api/admin/accounts', { actorId: 'admin' })).status, 401);
    assert.equal((await call('/api/auth/admin/login', { password: 'short' })).status, 400);
    assert.equal((await call('/api/auth/admin/login', { password: '密'.repeat(25) })).status, 400);
    assert.equal((await call('/api/auth/admin/login', { password: 'x'.repeat(9000) })).status, 413);
    assert.equal((await call('/api/auth/admin/login', [], undefined)).status, 400);
    const malformed = await worker.fetch(new Request('https://local/api/auth/login', {
        method: 'POST', headers: { Origin: 'https://local', 'Content-Type': 'application/json' }, body: '{',
    }), { DB: binding, APP_ENV: 'local' });
    assert.equal(malformed.status, 400);
    assert.throws(() => passwordField('密'.repeat(25)));
    assert.equal(passwordField('密'.repeat(24)), '密'.repeat(24));
});

test('login attempts are limited atomically, including nonexistent members', async () => {
    for (let i = 0; i < 10; i++) {
        assert.equal((await call('/api/auth/login', { schoolNumber: 'MISSING', password: testPassword })).status, 401);
    }
    assert.equal((await call('/api/auth/login', { schoolNumber: 'MISSING', password: testPassword })).status, 429);
    await binding.prepare('UPDATE login_attempts SET expires_at = unixepoch() - 1').run();
    assert.equal((await call('/api/auth/login', { schoolNumber: 'MISSING', password: testPassword })).status, 401);
});

test('concurrent first initialization creates exactly one administrator without orphan accounts', async () => {
    await binding.prepare("DELETE FROM account_roles WHERE account_id = 'admin'").run();
    await binding.prepare("DELETE FROM accounts WHERE id = 'admin'").run();
    const outcomes = await Promise.allSettled([
        initializeAdministrator(binding, testPassword),
        initializeAdministrator(binding, nextPassword),
    ]);
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await binding.prepare("SELECT COUNT(*) AS n FROM account_roles WHERE role = 'admin'").first('n'), 1);
    assert.equal(await binding.prepare('SELECT COUNT(*) AS n FROM credentials').first('n'), 1);
    assert.equal(await binding.prepare('SELECT COUNT(*) AS n FROM accounts').first('n'), 6);
});

test('concurrent password changes cannot overwrite each other using the same old session', async () => {
    const cookie = await adminCookie();
    const responses = await Promise.all([
        call('/api/auth/password', { oldPassword: testPassword, newPassword: nextPassword }, cookie),
        call('/api/auth/password', { oldPassword: testPassword, newPassword: 'test-third-password-789' }, cookie),
    ]);
    assert.equal(responses.filter((r) => r.status === 200).length, 1);
    assert.ok(responses.every((r) => [200, 401, 409].includes(r.status)));
    assert.equal((await call('/api/auth/me', undefined, cookie, 'GET')).status, 401);
});