import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareDemoData } from '../scripts/lib/demo-data.mjs';
import { parseDemoArguments } from '../scripts/prepare-demo.mjs';
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