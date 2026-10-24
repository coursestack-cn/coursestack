import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from '../src/index.ts';
import { digest, hashPassword, randomToken } from '../src/auth/crypto.ts';
import { consumeEmailToken } from '../src/auth/email.ts';
import { sendMail } from '../src/auth/mail.ts';
import { cleanupAvatars } from '../src/accounts/avatar.ts';

let runtime, binding, bucket, env, passwordHash;
const password = 'fictional-test-password-123';
const nextPassword = 'fictional-new-password-456';
const fixture = `
INSERT INTO accounts (id, public_name) VALUES ('admin', '管理员'), ('teacher', '公开教师'), ('student', '公开同学'), ('other', '其他同学'), ('free', '未修读同学');
INSERT INTO account_roles VALUES ('admin', 'admin'), ('teacher', 'teacher'), ('student', 'student'), ('other', 'student'), ('free', 'student');
INSERT INTO student_records (account_id, student_number, real_name) VALUES ('student', '001', '虚构甲'), ('other', '002', '虚构乙'), ('free', '003', '虚构丙');
INSERT INTO account_private (account_id, real_name, email) VALUES ('admin', NULL, 'admin@example.test'), ('teacher', '虚构教师', 'teacher@example.test'), ('student', '虚构甲', 'student@example.test'), ('other', '虚构乙', NULL), ('free', '虚构丙', NULL);
INSERT INTO courses (id, name) VALUES ('course', '当前课程'), ('other-course', '其他课程');
INSERT INTO terms VALUES ('current', '当前学期'), ('past', '历史学期');
UPDATE academic_settings SET current_term_id = 'current' WHERE id = 1;
INSERT INTO teaching_assignments (course_id, term_id, teacher_id) VALUES ('course', 'current', 'teacher');
INSERT INTO enrollments (course_id, term_id, student_id) VALUES ('course', 'current', 'student'), ('course', 'past', 'other');
`;

before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default { fetch() { return new Response("test"); } };',
    compatibilityDate: '2026-10-21', d1Databases: ['DB'], r2Buckets: ['FILES'],
  }));
  binding = await runtime.getD1Database('DB');
  bucket = await runtime.getR2Bucket('FILES');
  env = { DB: binding, FILES: bucket, APP_ENV: 'local', PUBLIC_ORIGIN: 'https://local' };
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await binding.batch(sql.split('-- statement-breakpoint').filter((s) => s.trim()).map((s) => binding.prepare(s)));
  }
  passwordHash = await hashPassword(password);
});
after(async () => { await runtime?.dispose(); });

beforeEach(async () => {
  await binding.exec(`
DELETE FROM email_tokens;
DELETE FROM avatar_objects;
DELETE FROM account_audit;
DELETE FROM account_private;
DELETE FROM sessions;
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
  for (const [id, number] of [['admin', null], ['teacher', 'T01'], ['student', '001'], ['other', '002'], ['free', '003']]) {
    await binding.prepare('INSERT INTO credentials (account_id, school_number, password_hash) VALUES (?, ?, ?)').bind(id, number, passwordHash).run();
  }
  const objects = await bucket.list();
  if (objects.objects.length) await bucket.delete(objects.objects.map((o) => o.key));
});

async function cookie(id) {
  const token = randomToken();
  await binding.prepare('INSERT INTO sessions SELECT ?, account_id, version, unixepoch() + 3600 FROM credentials WHERE account_id = ?').bind(await digest(token), id).run();
  return `coursestack_session=${token}`;
}

const call = (path, { method = 'GET', body, cookie, headers = {}, raw } = {}) => worker.fetch(new Request(`https://local${path}`, {
  method, headers: { Origin: 'https://local', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
  ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
}), env);
const patch = (id, body, auth) => call(`/api/admin/accounts/${id}`, { method: 'PATCH', body, cookie: auth });
const data = async (response) => (await response.json()).data;
const tokenFromMail = async () => {
  const messages = await bucket.list({ prefix: 'local-mail/' });
  assert.equal(messages.objects.length, 1);
  const message = await (await bucket.get(messages.objects[0].key)).json();
  return { ...message, token: message.text.match(/#token=([a-f0-9]{64})/)[1] };
};

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
  for (const privateCredential of ['passwordHash', 'password_hash', 'token_hash', passwordHash]) assert.ok(!responseText.includes(privateCredential));
});

test('disable/restore invalidates old sessions permanently and protects the sole admin', async () => {
  const admin = await cookie('admin'), member = await cookie('student');
  assert.equal((await patch('student', { revision: 1, status: 'disabled' }, admin)).status, 200);
  assert.equal((await call('/api/auth/me', { cookie: member })).status, 401);
  assert.equal((await call('/api/profiles/student')).status, 404);
  assert.equal((await patch('student', { revision: 2, status: 'active' }, admin)).status, 200);
  assert.equal((await call('/api/auth/me', { cookie: member })).status, 401);
  assert.equal((await call('/api/auth/me', { cookie: await cookie('student') })).status, 200);
  for (const field of [{ status: 'disabled' }, { role: 'teacher' }, { schoolNumber: '000' }]) {
    assert.equal((await patch('admin', { revision: 1, ...field }, admin)).status, 403);
  }
});

test('private changes synchronize school numbers and names, revoke sessions and preserve leading zeros', async () => {
  const admin = await cookie('admin'), member = await cookie('student');
  const result = await patch('student', { revision: 1, schoolNumber: ' 0009 ', realName: '更正姓名', email: ' New@Example.Test ' }, admin);
  assert.equal(result.status, 200);
  const profile = await data(result);
  assert.equal(profile.schoolNumber, '0009'); assert.equal(profile.email, 'new@example.test'); assert.equal(profile.emailVerifiedAt, null);
  assert.deepEqual(await binding.prepare("SELECT student_number, real_name FROM student_records WHERE account_id = 'student'").first(), { student_number: '0009', real_name: '更正姓名' });
  assert.equal((await call('/api/auth/me', { cookie: member })).status, 401);
  const teacherRead = await data(await call('/api/courses/course/students/student/academic-record', { cookie: await cookie('teacher') }));
  assert.equal(teacherRead.realName, '更正姓名'); assert.equal(teacherRead.studentNumber, '0009');
  assert.equal('email' in teacherRead, false);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { schoolNumber: '001', password } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { schoolNumber: '0009', password } })).status, 200);
});

test('duplicate identifiers roll back all fields and audit records', async () => {
  const admin = await cookie('admin');
  for (const change of [{ schoolNumber: '002' }, { email: 'teacher@example.test' }]) {
    assert.equal((await patch('student', { revision: 1, realName: '不应保存', ...change }, admin)).status, 409);
  }
  assert.equal(await binding.prepare("SELECT revision FROM accounts WHERE id = 'student'").first('revision'), 1);
  assert.equal(await binding.prepare("SELECT real_name FROM student_records WHERE account_id = 'student'").first('real_name'), '虚构甲');
  assert.equal(await binding.prepare('SELECT count(*) AS n FROM account_audit').first('n'), 0);
});

test('role changes preserve teaching/enrollment history and support unassociated members', async () => {
  const admin = await cookie('admin');
  assert.equal((await patch('student', { revision: 1, role: 'teacher' }, admin)).status, 409);
  assert.equal((await patch('other', { revision: 1, role: 'teacher' }, admin)).status, 409);
  assert.equal((await patch('teacher', { revision: 1, role: 'student' }, admin)).status, 409);
  assert.equal((await patch('free', { revision: 1, role: 'teacher' }, admin)).status, 200);
  assert.equal(await binding.prepare("SELECT account_id FROM student_records WHERE account_id = 'free'").first(), null);
  assert.equal((await patch('free', { revision: 2, role: 'student' }, admin)).status, 200);
  assert.equal(await binding.prepare("SELECT student_number FROM student_records WHERE account_id = 'free'").first('student_number'), '003');
  assert.equal((await patch('free', { revision: 3, role: 'admin' }, admin)).status, 400);
});

test('concurrent updates use revisions and cannot silently overwrite each other', async () => {
  const admin = await cookie('admin');
  const results = await Promise.all(['姓名甲', '姓名乙'].map((realName) => patch('student', { revision: 1, realName }, admin)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const audit = await data(await call('/api/admin/accounts/student/audit', { cookie: admin }));
  assert.equal(audit.total, 1); assert.deepEqual(audit.items[0].fields, ['realName']);
  assert.ok(!JSON.stringify(audit).includes('姓名'));
});

test('self editing permits only public fields; public profiles never expose academic/contact identity', async () => {
  const member = await cookie('student');
  const own = await data(await call('/api/me/profile', { cookie: member }));
  assert.equal(own.email, 'student@example.test'); assert.equal(own.realName, '虚构甲');
  for (const field of [{ email: 'other@example.test' }, { role: 'admin' }, { schoolNumber: '999' }, { realName: '越权' }, { status: 'active' }]) {
    assert.equal((await call('/api/me/profile', { method: 'PATCH', cookie: member, body: { revision: 1, publicName: '新名称', ...field } })).status, 400);
  }
  assert.equal((await call('/api/me/profile', { method: 'PATCH', cookie: member, body: { revision: 1, publicName: '新名称' } })).status, 200);
  assert.deepEqual(await data(await call('/api/profiles/student')), { id: 'student', publicName: '新名称', avatarUrl: null });
  assert.equal((await call('/api/admin/accounts/student', { cookie: member })).status, 403);
});

test('academic HTTP endpoint enforces current-course/current-term privacy', async () => {
  const teacher = await cookie('teacher');
  assert.equal((await call('/api/courses/course/students/student/academic-record', { cookie: teacher })).status, 200);
  assert.equal((await call('/api/courses/course/students/other/academic-record', { cookie: teacher })).status, 404);
  assert.equal((await call('/api/courses/other-course/students/student/academic-record', { cookie: teacher })).status, 404);
  assert.equal((await call('/api/courses/course/students/student/academic-record', { cookie: await cookie('other') })).status, 404);
  await binding.prepare("UPDATE academic_settings SET current_term_id = 'past'").run();
  assert.equal((await call('/api/courses/course/students/student/academic-record', { cookie: teacher })).status, 404);
});

// A 1x1 PNG. No real user images are used.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH7sAAAAASUVORK5CYII=', 'base64');
test('avatar upload/read/delete uses local R2 and enforces type, size and ownership', async () => {
  const member = await cookie('student');
  const upload = (raw, type = 'image/png', revision = '1') => call('/api/me/avatar', { method: 'PUT', cookie: member, raw, headers: { 'Content-Type': type, 'If-Match': `"${revision}"` } });
  assert.equal((await upload('<svg></svg>', 'image/svg+xml')).status, 415);
  assert.equal((await upload(png, 'image/jpeg')).status, 415);
  assert.equal((await upload(new Uint8Array(2 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await upload(png)).status, 200);
  assert.equal((await data(await call('/api/profiles/student'))).avatarUrl, '/api/profiles/student/avatar');
  const avatar = await call('/api/profiles/student/avatar');
  assert.equal(avatar.headers.get('content-type'), 'image/png'); assert.equal(avatar.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await avatar.arrayBuffer()), png);
  assert.equal((await upload(png)).status, 409);
  assert.equal((await call('/api/me/avatar', { method: 'DELETE', cookie: member, headers: { 'If-Match': '"2"' } })).status, 200);
  assert.equal((await call('/api/profiles/student/avatar')).status, 404);
  assert.equal((await bucket.list({ prefix: 'avatars/' })).objects.length, 0);
});

test('email verification is single-use and forgot-password hides missing/unverified addresses', async () => {
  const body = { email: 'student@example.test' };
  const beforeVerified = await call('/api/auth/password/forgot', { method: 'POST', body });
  const unknown = await call('/api/auth/password/forgot', { method: 'POST', body: { email: 'missing@example.test' } });
  assert.equal(beforeVerified.status, 202); assert.deepEqual(await beforeVerified.json(), await unknown.json());
  assert.equal((await bucket.list({ prefix: 'local-mail/' })).objects.length, 0);
  assert.equal((await call('/api/auth/email/verification', { method: 'POST', cookie: await cookie('student') })).status, 202);
  const mail = await tokenFromMail();
  assert.equal(mail.to, 'student@example.test'); assert.ok(mail.text.includes('https://local/verify-email#token='));
  assert.equal((await call('/api/auth/email/verify', { method: 'POST', body: { token: mail.token } })).status, 200);
  assert.equal((await call('/api/auth/email/verify', { method: 'POST', body: { token: mail.token } })).status, 400);
  assert.ok(await binding.prepare("SELECT email_verified_at FROM account_private WHERE account_id = 'student'").first('email_verified_at'));
});

test('verified email password recovery changes the password and revokes every old session', async () => {
  const first = await cookie('student'), second = await cookie('student');
  await binding.prepare("UPDATE account_private SET email_verified_at = unixepoch() WHERE account_id = 'student'").run();
  assert.equal((await call('/api/auth/password/forgot', { method: 'POST', body: { email: ' Student@Example.Test ' } })).status, 202);
  const mail = await tokenFromMail();
  const row = await binding.prepare('SELECT token_hash FROM email_tokens').first();
  assert.equal(row.token_hash, await digest(mail.token)); assert.notEqual(row.token_hash, mail.token);
  assert.equal((await call('/api/auth/password/reset', { method: 'POST', body: { token: mail.token, newPassword: nextPassword } })).status, 200);
  for (const auth of [first, second]) assert.equal((await call('/api/auth/me', { cookie: auth })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { schoolNumber: '001', password } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { schoolNumber: '001', password: nextPassword } })).status, 200);
  assert.equal((await call('/api/auth/password/reset', { method: 'POST', body: { token: mail.token, newPassword: password } })).status, 400);
});

test('recovery also works for the sole administrator without an account-number login', async () => {
  await binding.prepare("UPDATE account_private SET email_verified_at = unixepoch() WHERE account_id = 'admin'").run();
  await call('/api/auth/password/forgot', { method: 'POST', body: { email: 'admin@example.test' } });
  const { token } = await tokenFromMail();
  assert.equal((await call('/api/auth/password/reset', { method: 'POST', body: { token, newPassword: nextPassword } })).status, 200);
  assert.equal((await call('/api/auth/admin/login', { method: 'POST', body: { password: nextPassword } })).status, 200);
});

test('changing email invalidates previous links and requires verification again', async () => {
  const admin = await cookie('admin');
  await call('/api/auth/email/verification', { method: 'POST', cookie: await cookie('student') });
  const { token } = await tokenFromMail();
  assert.equal((await patch('student', { revision: 1, email: 'new@example.test' }, admin)).status, 200);
  assert.equal((await call('/api/auth/email/verify', { method: 'POST', body: { token } })).status, 400);
  assert.equal(await binding.prepare("SELECT email_verified_at FROM account_private WHERE account_id = 'student'").first('email_verified_at'), null);
});

test('expired tokens and verification tokens cannot reset passwords; concurrent recovery succeeds once', async () => {
  await call('/api/auth/email/verification', { method: 'POST', cookie: await cookie('student') });
  const verify = await tokenFromMail();
  await assert.rejects(consumeEmailToken(env, verify.token, 'reset-password', nextPassword), (e) => e.code === 'INVALID_EMAIL_TOKEN');
  await binding.prepare('UPDATE email_tokens SET expires_at = unixepoch() - 1').run();
  await assert.rejects(consumeEmailToken(env, verify.token, 'verify-email'), (e) => e.code === 'INVALID_EMAIL_TOKEN');
  await bucket.delete((await bucket.list({ prefix: 'local-mail/' })).objects.map((o) => o.key));
  await binding.prepare("UPDATE account_private SET email_verified_at = unixepoch() WHERE account_id = 'student'").run();
  await call('/api/auth/password/forgot', { method: 'POST', body: { email: 'student@example.test' } });
  const reset = await tokenFromMail();
  const results = await Promise.allSettled([consumeEmailToken(env, reset.token, 'reset-password', nextPassword), consumeEmailToken(env, reset.token, 'reset-password', password)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('email routes reject cross-origin requests and throttle repeated recovery requests', async () => {
  assert.equal((await call('/api/auth/password/forgot', { method: 'POST', body: { email: 'student@example.test' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await call('/api/auth/password/forgot', { method: 'POST', body: { email: 'missing@example.test' } })).status, 202);
  assert.equal((await call('/api/auth/password/forgot', { method: 'POST', body: { email: 'missing@example.test' } })).status, 429);
});

test('cloud mail adapter handles provider errors without exposing credentials or provider bodies', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => { captured = { url, body: JSON.parse(options.body) }; return new Response('private provider error', { status: 500 }); };
  try {
    await assert.rejects(sendMail({ ...env, APP_ENV: 'dev', RESEND_API_KEY: 'test-placeholder', EMAIL_FROM: 'noreply@example.test' }, { to: 'student@example.test', subject: 'Test', text: 'Test only' }), (error) => error.code === 'MAIL_UNAVAILABLE' && !error.message.includes('private'));
    assert.equal(captured.url, 'https://api.resend.com/emails'); assert.equal(captured.body.from, 'noreply@example.test');
  } finally { globalThis.fetch = originalFetch; }
});

test('failed old-avatar cleanup preserves a successful update and is recoverable', async () => {
  const member = await cookie('student');
  const request = (revision) => new Request('https://local/api/me/avatar', { method: 'PUT',
    headers: { Origin: 'https://local', Cookie: member, 'Content-Type': 'image/png', 'If-Match': `"${revision}"` }, body: png });
  assert.equal((await worker.fetch(request(1), env)).status, 200);
  const failedDelete = { ...env, FILES: { put: bucket.put.bind(bucket), delete: async () => { throw new Error('temporary R2 failure'); } } };
  assert.equal((await worker.fetch(request(2), failedDelete)).status, 200);
  assert.equal((await bucket.list({ prefix: 'avatars/' })).objects.length, 2);
  await binding.prepare('UPDATE avatar_objects SET created_at = unixepoch() - 7200').run();
  assert.equal(await cleanupAvatars(env), 1);
  assert.equal((await bucket.list({ prefix: 'avatars/' })).objects.length, 1);
  assert.equal((await call('/api/profiles/student/avatar')).status, 200);
});

test('revoked administrator sessions cannot mutate accounts and disabled accounts cannot redeem email tokens', async () => {
  const admin = await cookie('admin');
  await binding.prepare("DELETE FROM sessions WHERE account_id = 'admin'").run();
  assert.equal((await patch('student', { revision: 1, realName: '越权修改' }, admin)).status, 401);
  await binding.prepare("UPDATE account_private SET email_verified_at = unixepoch() WHERE account_id = 'student'").run();
  await call('/api/auth/password/forgot', { method: 'POST', body: { email: 'student@example.test' } });
  const { token } = await tokenFromMail();
  assert.equal((await patch('student', { revision: 1, status: 'disabled' }, await cookie('admin'))).status, 200);
  await assert.rejects(consumeEmailToken(env, token, 'reset-password', nextPassword), (error) => error.code === 'INVALID_EMAIL_TOKEN');
});