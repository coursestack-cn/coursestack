import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareDemoData } from '../scripts/lib/demo-data.mjs';
import { clearBucket, resetDemoData } from '../scripts/lib/demo-reset.mjs';
import { readMigrations } from '../scripts/lib/migrations.mjs';
import { parseDemoArguments } from '../scripts/prepare-demo.mjs';
import { parseResetArguments } from '../scripts/reset-demo.mjs';
import { hashPassword } from '../src/auth/crypto.ts';
import { login } from '../src/auth/service.ts';
import { start, setCurrentTerm } from './discussions-helpers.mjs';

test('demo preparation creates 100 students and a teacher, enrolls the current term and preserves changes on rerun', async () => {
    const app = await start();
    const db = app.database;
    try {
        const preview = await prepareDemoData(db, { dryRun: true });
        assert.equal(preview.createdAccounts, 101);
        assert.equal(preview.termId, 'term-active');
        assert.equal(await db.prepare('SELECT count(*) AS n FROM accounts').first('n'), 6);
        const result = await prepareDemoData(db);
        assert.equal(result.courseName, '数据库系统原理');
        assert.equal(result.createdAccounts, 101);
        assert.equal(await db.prepare("SELECT count(*) AS n FROM enrollments WHERE course_id = ? AND term_id = ? AND account_id IN (SELECT id FROM accounts WHERE role='student')").bind(result.courseId, result.termId).first('n'), 100);
        assert.equal(await db.prepare("SELECT count(*) AS n FROM enrollments WHERE course_id = ? AND term_id = ? AND account_id IN (SELECT id FROM accounts WHERE role='teacher')").bind(result.courseId, result.termId).first('n'), 1);
        assert.deepEqual((await db.prepare(`SELECT role, department, major, grade, count(*) AS n FROM accounts
            WHERE school_number GLOB '[ST]0[0-9][0-9][0-9]' GROUP BY role, department, major, grade ORDER BY role`).all()).results, [
            { role: 'student', department: '计算机学院', major: '计算机科学与技术', grade: '2024 级', n: 100 },
            { role: 'teacher', department: '计算机学院', major: '计算机科学与技术', grade: null, n: 1 },
        ]);
        for (const number of ['S0001', 'S0100', 'T0001']) {
            const authenticated = await login(db, number, number);
            assert.equal(authenticated.profile.mustChangePassword, false);
            assert.equal(authenticated.profile.role, number[0] === 'T' ? 'teacher' : 'student');
        }
        const changedHash = await hashPassword('changed-demo-password');
        await db.prepare("UPDATE accounts SET password = ?, must_change_password = 1 WHERE school_number = 'S0001'").bind(changedHash).run();
        await db.prepare("UPDATE accounts SET nickname = '用户改过名称', status = 'disabled' WHERE school_number = 'S0001'").run();
        const repeat = await prepareDemoData(db);
        assert.equal(repeat.createdAccounts, 0);
        assert.equal(repeat.existingAccounts, 101);
        const preserved = await db.prepare("SELECT password, must_change_password, nickname, status FROM accounts WHERE school_number = 'S0001'").first();
        assert.deepEqual(preserved, { password: changedHash, must_change_password: 1, nickname: '用户改过名称', status: 'disabled' });
        const switchingTerm = {
            prepare: db.prepare.bind(db),
            async batch(statements) {
                if (statements.length > 3) await setCurrentTerm(db, 'term-old');
                return db.batch(statements);
            },
        };
        await assert.rejects(prepareDemoData(switchingTerm), { code: 'DEMO_CONFLICT' });
        assert.equal(await db.prepare('SELECT count(*) AS n FROM enrollments WHERE course_id = ?').bind(result.courseId).first('n'), 101);
        await setCurrentTerm(db, null);
        await assert.rejects(prepareDemoData(db), { code: 'DEMO_CONFLICT' });
        assert.equal(await db.prepare('SELECT count(*) AS n FROM enrollments WHERE course_id=?').bind(result.courseId).first('n'), 101);
    } finally { await app.dispose(); }
});

test('demo preparation rejects unrelated account collisions and ambiguous courses without writing', async () => {
    const app = await start();
    try {
        await app.database.prepare("UPDATE accounts SET school_number = 'S0001' WHERE id = 'student-a'").run();
        await assert.rejects(prepareDemoData(app.database), { code: 'DEMO_CONFLICT' });
        assert.equal(await app.database.prepare('SELECT count(*) AS n FROM accounts').first('n'), 6);
        await app.database.prepare("UPDATE accounts SET school_number = 'student-a' WHERE id = 'student-a'").run();
        await app.database.prepare("UPDATE courses SET name = '数据库系统原理'").run();
        await assert.rejects(prepareDemoData(app.database, { dryRun: true }), { code: 'DEMO_CONFLICT' });
        await assert.rejects(prepareDemoData(app.database, { dryRun: true, course: 'course-a' }), { code: 'DEMO_CONFLICT' });
        assert.equal(await app.database.prepare('SELECT count(*) AS n FROM accounts').first('n'), 6);
        await app.database.prepare("INSERT INTO terms(id,name) VALUES ('next','下一学期')").run();
        await setCurrentTerm(app.database, 'next');
        assert.equal((await prepareDemoData(app.database, { dryRun: true, course: 'course-a' })).courseId, 'course-a');
    } finally { await app.dispose(); }
});

test('demo command requires an explicit database target and rejects credentials in arguments', () => {
    for (const args of [[], ['--local', '--remote'], ['--remote'], ['--local', '--local'], ['--local', '--token', 'fictional'], ['--remote', '--config', 'target.json', '--persist-to', 'state']]) {
        assert.throws(() => parseDemoArguments(args));
    }
    assert.equal(parseDemoArguments(['--local', '--dry-run'])['dry-run'], true);
    assert.equal(parseDemoArguments(['--remote', '--config', 'target.json']).remote, true);
});

test('demo reset rebuilds the database with the demo set and keeps only the admin credential', async () => {
    const app = await start();
    const db = app.database;
    const objects = "SELECT count(*) AS n FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'";
    try {
        await db.prepare("UPDATE accounts SET nickname = '值班管理员' WHERE id = 'admin'").run();
        const password = await db.prepare("SELECT password FROM accounts WHERE id = 'admin'").first('password');
        // Ledger rows refuse DELETE, so the reset must still drop them.
        await app.policy({ pointsQuestion: 5 });
        await app.postQuestion();
        assert.ok(await db.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n') > 0);
        const steps = [];
        const result = await resetDemoData(db, {
            async clearFiles() { steps.push('files'); assert.equal(await db.prepare(objects).first('n'), 0); return 2; },
            async migrate() { steps.push('migrate'); for (const { statements } of await readMigrations()) await db.batch(statements.map((s) => db.prepare(s))); },
            async seed() { steps.push('seed'); await db.prepare("INSERT INTO terms (id, name, current) VALUES ('demo-current', '演示当前学期', 1)").run(); },
        });
        assert.deepEqual(steps, ['files', 'migrate', 'seed']);
        assert.equal(result.deletedFiles, 2);
        assert.equal(result.administratorId, 'admin');
        assert.equal(result.createdAccounts, 101);
        assert.deepEqual(await db.prepare("SELECT nickname, password, credential_version FROM accounts WHERE role = 'admin'").first(),
            { nickname: '值班管理员', password, credential_version: 1 });
        assert.equal(await db.prepare('SELECT count(*) AS n FROM accounts').first('n'), 102);
        assert.equal(await db.prepare('SELECT count(*) AS n FROM sessions').first('n'), 0);
        assert.equal(await db.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n'), 0);
        assert.deepEqual((await db.prepare('SELECT name, code FROM courses').all()).results, [{ name: '数据库系统原理', code: '304208040' }]);
        assert.equal(await db.prepare('SELECT id FROM terms WHERE current = 1').first('id'), 'demo-current');
    } finally { await app.dispose(); }
});

test('demo reset lists every R2 page before deleting each object', async () => {
    const accountId = 'a'.repeat(32);
    const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/coursestack-files/objects`;
    const pages = {
        '': { result: [{ key: 'avatars/a/1' }], result_info: { is_truncated: true, cursor: 'next page' } },
        'next page': { result: [{ key: 'a b/c?d' }], result_info: { is_truncated: false } },
    };
    const calls = [];
    const request = async (url, init) => {
        calls.push(`${init.method} ${url}`);
        assert.equal(init.headers.Authorization, 'Bearer fictional-token');
        if (init.method === 'GET') return Response.json({ success: true, ...pages[new URL(url).searchParams.get('cursor') ?? ''] });
        return Response.json({ success: true }, { status: url.endsWith('%3Fd') ? 404 : 200 });
    };
    const target = { accountId, bucket: 'coursestack-files', token: 'fictional-token' };
    assert.equal(await clearBucket(target, request), 2);
    assert.deepEqual(calls, [
        `GET ${base}?per_page=1000`,
        `GET ${base}?per_page=1000&cursor=next%20page`,
        `DELETE ${base}/avatars/a/1`,
        `DELETE ${base}/a%20b/c%3Fd`,
    ]);
    await assert.rejects(clearBucket(target, async () => Response.json({ success: false }, { status: 403 })), { code: 'R2_OPERATION_FAILED' });
    await assert.rejects(clearBucket(target, async (url, init) => init.method === 'GET'
        ? Response.json({ success: true, result: [{ key: 'kept' }] }) : new Response(null, { status: 500 })), { code: 'R2_OPERATION_FAILED' });
});

test('demo reset command requires the target D1 ID and rejects credentials in arguments', () => {
    for (const args of [[], ['--confirm', 'a', '--confirm', 'b'], ['--confirm', 'a', '--token', 'fictional'], ['--remote']]) {
        assert.throws(() => parseResetArguments(args));
    }
    assert.equal(parseResetArguments(['--confirm', 'd1-id']).confirm, 'd1-id');
});