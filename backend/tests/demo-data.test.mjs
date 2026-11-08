import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareDemoData } from '../scripts/lib/demo-data.mjs';
import { clearBucket, resetDemoData } from '../scripts/lib/demo-reset.mjs';
import { readMigrations } from '../scripts/lib/migrations.mjs';
import { parseDemoArguments, runDemoCommand } from '../scripts/demo.mjs';
import { parseDatabaseArguments } from '../scripts/lib/database-cli.mjs';
import { hashPassword } from '../src/auth/crypto.ts';
import { login } from '../src/auth/service.ts';
import { start, setCurrentTerm } from './discussions-helpers.mjs';

async function assertDemoRosters(db, currentTerm) {
    const { results } = await db.prepare(`SELECT ct.course_id AS course, ct.term_id AS term,
        teacher.school_number AS teacher, student.school_number AS student FROM course_terms ct
        LEFT JOIN teaching_classes tc USING(course_id,term_id) LEFT JOIN accounts teacher ON teacher.id=tc.teacher_id
        LEFT JOIN class_students cs USING(course_id,term_id,teacher_id) LEFT JOIN accounts student ON student.id=cs.student_id
        WHERE ct.course_id IN ('304208040','304064030','101103020') ORDER BY student.school_number`).all();
    const classes = [
        ['304208040', currentTerm, 'T0001', 1, 50],
        ['304064030', currentTerm, 'T0001', 26, 50], ['304064030', currentTerm, 'T0002', 51, 75],
        ['101103020', currentTerm, 'T0003', 76, 84], ['101103020', currentTerm, 'T0004', 85, 92],
        ['101103020', currentTerm, 'T0005', 93, 100],
        ['101103020', '25-2', 'T0003', 51, 75], ['101103020', '25-2', 'T0004', 76, 100],
    ];
    assert.equal(results.length, 175);
    for (const [course, term, teacher, first, last] of classes) {
        const actual = results.filter(row => row.course === course && row.term === term && row.teacher === teacher);
        const expected = Array.from({ length: last - first + 1 }, (_, i) => 'S' + String(first + i).padStart(4, '0'));
        assert.deepEqual(actual.map(row => row.student), expected, `${course} / ${term} / ${teacher}`);
    }
}

test('demo preparation seeds both terms and preserves course and account edits on rerun', async () => {
    const app = await start();
    const db = app.database;
    try {
        const preview = await prepareDemoData(db, { dryRun: true });
        assert.equal(preview.createdAccounts, 105);
        assert.equal(preview.termId, 'term-active');
        assert.equal(await db.prepare('SELECT count(*) AS n FROM accounts').first('n'), 6);
        const result = await prepareDemoData(db);
        assert.equal(result.courseName, '数据库系统原理');
        assert.equal(result.createdAccounts, 105);
        assert.match(await db.prepare('SELECT introduction FROM courses WHERE id=?').bind(result.courseId).first('introduction'), /关系模型.*SQL/);
        await assertDemoRosters(db, result.termId);
        assert.equal(await db.prepare('SELECT id FROM terms WHERE current=1').first('id'), result.termId);
        assert.deepEqual(await db.prepare("SELECT name,current FROM terms WHERE id='25-2'").first(), { name: '2026春', current: 0 });
        assert.deepEqual((await db.prepare(`SELECT role, department, major, grade, count(*) AS n FROM accounts
            WHERE school_number GLOB '[ST]0[0-9][0-9][0-9]' GROUP BY role, department, major, grade ORDER BY role`).all()).results, [
            { role: 'student', department: '计算机学院', major: '计算机科学与技术', grade: '2024 级', n: 100 },
            { role: 'teacher', department: '计算机学院', major: '计算机科学与技术', grade: null, n: 5 },
        ]);
        for (const number of ['S0001', 'S0100', 'T0001', 'T0002', 'T0003', 'T0004', 'T0005']) {
            const authenticated = await login(db, number, number);
            assert.equal(authenticated.profile.mustChangePassword, false);
            assert.equal(authenticated.profile.role, number[0] === 'T' ? 'teacher' : 'student');
            if (number[0] === 'T') assert.equal(authenticated.profile.nickname, `演示教师 ${number.slice(-3)}`);
        }
        await db.prepare("UPDATE courses SET introduction='自定义课程简介' WHERE id=?").bind(result.courseId).run();
        const changedHash = await hashPassword('changed-demo-password');
        await db.prepare("UPDATE accounts SET password = ?, must_change_password = 1 WHERE school_number = 'S0001'").bind(changedHash).run();
        await db.prepare("UPDATE accounts SET nickname = '用户改过名称', status = 'disabled' WHERE school_number = 'S0001'").run();
        const repeat = await prepareDemoData(db);
        assert.equal(repeat.createdAccounts, 0);
        assert.equal(repeat.existingAccounts, 105);
        await assertDemoRosters(db, result.termId);
        assert.equal(await db.prepare('SELECT introduction FROM courses WHERE id=?').bind(result.courseId).first('introduction'), '自定义课程简介');
        const preserved = await db.prepare("SELECT password, must_change_password, nickname, status FROM accounts WHERE school_number = 'S0001'").first();
        assert.deepEqual(preserved, { password: changedHash, must_change_password: 1, nickname: '用户改过名称', status: 'disabled' });
        let preparingWrites = false;
        const switchingTerm = {
            prepare(sql) {
                if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) preparingWrites = true;
                return db.prepare(sql);
            },
            async batch(statements) {
                if (preparingWrites) await setCurrentTerm(db, 'term-old');
                return db.batch(statements);
            },
        };
        await assert.rejects(prepareDemoData(switchingTerm), { code: 'DEMO_CONFLICT' });
        assert.equal(await db.prepare('SELECT id FROM terms WHERE current=1').first('id'), 'term-old');
        await assertDemoRosters(db, result.termId);
        await setCurrentTerm(db, null);
        await assert.rejects(prepareDemoData(db), { code: 'DEMO_CONFLICT' });
        await assertDemoRosters(db, result.termId);
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
        assert.equal((await prepareDemoData(app.database, { dryRun: true, course: 'course-a' })).courseId, 'course-a');
        assert.equal(await app.database.prepare('SELECT count(*) AS n FROM accounts').first('n'), 6);
        await app.database.prepare("INSERT INTO terms(id,name) VALUES ('next','下一学期')").run();
        await setCurrentTerm(app.database, 'next');
        assert.equal((await prepareDemoData(app.database, { dryRun: true, course: 'course-a' })).courseId, 'course-a');
    } finally { await app.dispose(); }
});

test('demo command requires an explicit database target and rejects credentials in arguments', () => {
    for (const args of [[], ['--local', '--remote'], ['--remote'], ['--local', '--local'], ['--local', '--token', 'fictional'], ['--remote', 'target.json', '--persist-to', 'state']]) {
        assert.throws(() => parseDemoArguments(args));
    }
    for (const args of [['--local', '--dry-run'], ['--local', '--course-id', 'course'], ['--local', '--confirm', 'local']]) {
        assert.throws(() => parseDemoArguments(args));
    }
    for (const action of ['seed', 'setup']) assert.throws(() => parseDatabaseArguments([action, '--local']), { code: 'INVALID_ACTION' });
    assert.equal(parseDemoArguments(['--local']).local, true);
    assert.equal(parseDemoArguments(['--remote', 'target.json']).remote, 'target.json');
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
        const tables = await db.prepare(objects).first('n');
        const steps = [];
        const unreachable = async () => { steps.push('unreachable'); };
        // A token without R2 access fails before anything in D1 changes.
        const denied = { accountId: 'a'.repeat(32), bucket: 'coursestack-files', token: 'fictional-token' };
        await assert.rejects(resetDemoData(db, {
            clearFiles: () => clearBucket(denied, async () => Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 })),
            migrate: unreachable, seed: unreachable,
        }), { code: 'R2_OPERATION_FAILED' });
        assert.deepEqual(steps, []);
        assert.equal(await db.prepare(objects).first('n'), tables);
        assert.equal(await db.prepare("SELECT password FROM accounts WHERE id = 'admin'").first('password'), password);
        const result = await resetDemoData(db, {
            async clearFiles() { steps.push('files'); assert.equal(await db.prepare(objects).first('n'), tables); return 2; },
            async migrate() {
                steps.push('migrate');
                assert.equal(await db.prepare(objects).first('n'), 0);
                for (const { statements } of await readMigrations()) await db.batch(statements.map((s) => db.prepare(s)));
            },
            async seed() {
                steps.push('seed');
                assert.equal(await db.prepare("SELECT id FROM accounts WHERE role = 'admin'").first('id'), 'admin');
                await db.prepare(`INSERT INTO terms (id, name, current)
                    VALUES ('26-1', '2026秋', 1), ('25-2', '2026春', 0)`).run();
            },
        });
        assert.deepEqual(steps, ['files', 'migrate', 'seed']);
        assert.equal(result.deletedFiles, 2);
        assert.equal(result.administratorId, 'admin');
        assert.equal(result.createdAccounts, 105);
        assert.deepEqual(await db.prepare("SELECT nickname, password, credential_version FROM accounts WHERE role = 'admin'").first(),
            { nickname: '值班管理员', password, credential_version: 1 });
        assert.equal(await db.prepare('SELECT count(*) AS n FROM accounts').first('n'), 106);
        assert.equal(await db.prepare('SELECT count(*) AS n FROM sessions').first('n'), 0);
        assert.equal(await db.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n'), 0);
        assert.deepEqual((await db.prepare('SELECT name, id FROM courses ORDER BY id').all()).results, [
            { name: '大学美育·音乐鉴赏', id: '101103020' }, { name: '现代软件工程（双语）', id: '304064030' },
            { name: '数据库系统原理', id: '304208040' },
        ]);
        await assertDemoRosters(db, '26-1');
        assert.equal(await db.prepare('SELECT id FROM terms WHERE current = 1').first('id'), '26-1');
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
    // Failures name the request, status and numeric error codes, never the provider message.
    const denied = await clearBucket(target, async () => Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 }))
        .then(() => assert.fail('expected R2 failure'), (error) => error);
    assert.equal(denied.code, 'R2_OPERATION_FAILED');
    assert.match(denied.message, /GET HTTP 403，Cloudflare 错误 10000/);
    assert.doesNotMatch(denied.message, /Authentication error/);
    await assert.rejects(clearBucket(target, async (url, init) => init.method === 'GET'
        ? Response.json({ success: true, result: [{ key: 'kept' }] }) : new Response(null, { status: 500 })), { code: 'R2_OPERATION_FAILED', message: /DELETE HTTP 500）/ });
    await assert.rejects(clearBucket(target, async () => { throw new TypeError('network'); }), { message: /GET 未收到响应/ });
});

test('demo help describes the always-reset command without accessing credentials or resources', async () => {
    const unavailable = () => assert.fail('help must not access credentials or resources');
    let text = '';
    await runDemoCommand(['--help'], { prompt: unavailable, invoke: unavailable, openLocal: unavailable,
        request: unavailable, output: { write(value) { text += value; } } });
    assert.match(text, /pnpm demo --local/);
    assert.match(text, /pnpm demo --remote/);
    assert.match(text, /每次执行都重置/);
    assert.doesNotMatch(text, /--confirm|--dry-run|demo:prepare|demo:reset/);
});