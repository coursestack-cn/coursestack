import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { classRoutes } from '../src/courses/classes.ts';
import { start, setCurrentTerm } from './discussions-helpers.mjs';

const classPath = '/courses/course-a/terms/term-active/teachers/teacher-a';
const importPath = `${classPath}/students/import`;
async function setup(t) {
    const h = await start();
    t.after(() => h.dispose());
    return h;
}
async function student(h, id, number, status = 'active') {
    await h.database.prepare('INSERT INTO accounts(id,role,school_number,status) VALUES (?,\'student\',?,?)').bind(id, number, status).run();
}
const count = h => h.database.prepare('SELECT COUNT(*) AS n FROM class_students').first('n');

test('imports valid students, normalizes duplicates and reports each failure without exposing other student data', async t => {
    const h = await setup(t);
    await student(h, 'new-student', '00123');
    await student(h, 'disabled-student', 'disabled-number', 'disabled');
    await student(h, 'deleted-student', 'deleted-number', 'deleted');
    await student(h, 'conflict-student', 'other-class');
    await h.database.batch([
        h.database.prepare("INSERT INTO teaching_classes VALUES('course-a','term-active','teacher-b')"),
        h.database.prepare("INSERT INTO class_students VALUES('course-a','term-active','conflict-student','teacher-b')"),
    ]);
    const ledgerBefore = (await h.database.prepare('SELECT * FROM bonus_ledger ORDER BY id').all()).results;
    const schoolNumbers = [' 00123 ', '', 'student-a', '00123', 'missing', 'teacher-a', 'deleted-number', 'other-class', 'x'.repeat(81), 'disabled-number'];
    const result = await h.api('POST', importPath, 'teacher-a', { schoolNumbers });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.deepEqual({ ...result.data, items: undefined }, { addedCount: 2, existingCount: 1, failedCount: 5, duplicateCount: 1, items: undefined });
    assert.deepEqual(result.data.items.map(({ schoolNumber, status, code }) => [schoolNumber, status, code]), [
        ['00123', 'added', undefined], ['student-a', 'existing', undefined], ['missing', 'failed', 'STUDENT_NOT_FOUND'],
        ['teacher-a', 'failed', 'STUDENT_NOT_FOUND'], ['deleted-number', 'failed', 'STUDENT_NOT_FOUND'],
        ['other-class', 'failed', 'STUDENT_ASSIGNMENT_CONFLICT'], ['x'.repeat(81), 'failed', 'INVALID_SCHOOL_NUMBER'], ['disabled-number', 'added', undefined],
    ]);
    for (const item of result.data.items) assert.deepEqual(Object.keys(item).sort(), item.status === 'failed'
        ? ['code', 'message', 'schoolNumber', 'status'] : ['schoolNumber', 'status']);
    assert.equal(await h.database.prepare("SELECT teacher_id FROM class_students WHERE student_id='conflict-student'").first('teacher_id'), 'teacher-b');
    assert.deepEqual((await h.database.prepare('SELECT * FROM bonus_ledger ORDER BY id').all()).results, ledgerBefore);
    const before = await count(h);
    const retry = await h.api('POST', importPath, 'teacher-a', { schoolNumbers });
    assert.equal(retry.data.addedCount, 0);
    assert.equal(retry.data.existingCount, 3);
    assert.equal(retry.data.failedCount, 5);
    assert.equal(await count(h), before);
});

test('imports up to 500 students in one request and rejects malformed or oversized lists before writing', async t => {
    const h = await setup(t);
    const schoolNumbers = Array.from({ length: 500 }, (_, i) => String(i).padStart(6, '0'));
    await h.database.prepare("INSERT INTO accounts(id,role,school_number) SELECT 'bulk-'||value,'student',value FROM json_each(?)")
        .bind(JSON.stringify(schoolNumbers)).run();
    const before = await count(h);
    for (const body of [{ schoolNumbers: [] }, { schoolNumbers: ['', '  '] }, { schoolNumbers: ['000000', 1] },
        { schoolNumbers: '000000' }, { schoolNumbers: [...schoolNumbers, 'overflow'] }, { schoolNumbers, teacherId: 'teacher-b' }]) {
        const result = await h.api('POST', importPath, 'teacher-a', body);
        assert.equal(result.status, 400, JSON.stringify(result.payload));
        assert.equal(await count(h), before);
    }
    const result = await h.api('POST', importPath, 'teacher-a', { schoolNumbers });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.equal(result.data.addedCount, 500);
    assert.equal(result.data.items.length, 500);
    assert.equal(result.data.failedCount, 0);
    assert.equal(await count(h), before + 500);
    assert.equal(result.data.items[0].schoolNumber, '000000');
});

test('enforces login, class ownership and current term for teachers and administrators', async t => {
    const h = await setup(t), body = { schoolNumbers: ['visitor'] }, before = await count(h);
    for (const [who, status] of [[null, 401], ['student-a', 403], ['teacher-b', 403]]) {
        assert.equal((await h.api('POST', importPath, who, body)).status, status);
    }
    assert.equal((await h.api('POST', importPath, 'teacher-a', body, { headers: { Origin: 'http://other.test' } })).status, 403);
    const oldPath = '/courses/course-a/terms/term-old/teachers/teacher-b/students/import';
    assert.equal((await h.api('POST', oldPath, 'teacher-b', body)).status, 403);
    assert.equal((await h.api('POST', oldPath, 'admin', body)).status, 409);
    assert.equal((await h.api('POST', importPath.replace('teacher-a', 'missing'), 'admin', body)).status, 404);
    assert.equal(await count(h), before);
    assert.equal((await h.api('POST', importPath, 'admin', body)).data.addedCount, 1);
    await setCurrentTerm(h.database, null);
    assert.equal((await h.api('POST', importPath, 'admin', body)).status, 409);
    assert.equal((await h.api('POST', importPath, 'teacher-a', body)).status, 403);
});

test('concurrent imports never duplicate or transfer a student and report the actual winner', async t => {
    const h = await setup(t);
    await h.database.prepare("INSERT INTO teaching_classes VALUES('course-a','term-active','teacher-b')").run();
    const sameClass = await Promise.all([1, 2].map(() => h.api('POST', importPath, 'teacher-a', { schoolNumbers: ['visitor'] })));
    assert.deepEqual(sameClass.map(r => r.status), [200, 200]);
    assert.deepEqual(sameClass.map(r => r.data.addedCount).sort(), [0, 1]);
    assert.deepEqual(sameClass.map(r => r.data.existingCount).sort(), [0, 1]);
    await student(h, 'racing-student', 'race');
    const race = await Promise.all(['teacher-a', 'teacher-b'].map(who => h.api('POST', importPath.replace('teacher-a', who), who, { schoolNumbers: ['race'] })));
    assert.deepEqual(race.map(r => r.status), [200, 200]);
    assert.deepEqual(race.map(r => r.data.addedCount).sort(), [0, 1]);
    assert.deepEqual(race.map(r => r.data.failedCount).sort(), [0, 1]);
    assert.equal(race.find(r => r.data.failedCount).data.items[0].code, 'STUDENT_ASSIGNMENT_CONFLICT');
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM class_students WHERE student_id='racing-student'").first('n'), 1);
});

test('rechecks the term and actor identity at the write even when initial authorization succeeded', async t => {
    for (const change of ['term', 'actor']) {
        const h = await setup(t), before = await count(h);
        const binding = new Proxy(h.database, { get(target, key) {
            if (key === 'batch') return async statements => {
                if (change === 'term') await setCurrentTerm(h.database, 'term-old');
                else await h.database.prepare("UPDATE accounts SET status='deleted' WHERE id='teacher-a'").run();
                return target.batch(statements);
            };
            return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
        } });
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('actor', { id: 'teacher-a', role: 'teacher' }); await next(); });
        app.onError((error, c) => c.json({ code: error.code }, error.status ?? 500));
        app.route('/', classRoutes);
        const response = await app.request(importPath, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolNumbers: ['visitor'] }) }, { DB: binding });
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, 'CLASS_IMPORT_UNAVAILABLE');
        assert.equal(await count(h), before);
    }
});

test('a database error rolls back the import and a retry can safely complete it', async t => {
    const h = await setup(t);
    await student(h, 'rollback-student', 'rollback');
    await h.database.prepare("CREATE TRIGGER reject_import BEFORE INSERT ON class_students WHEN NEW.student_id='visitor' BEGIN SELECT RAISE(ABORT,'synthetic_import_failure'); END").run();
    const before = await count(h), body = { schoolNumbers: ['rollback', 'visitor'] };
    const failed = await h.api('POST', importPath, 'teacher-a', body);
    assert.equal(failed.status, 500);
    assert.equal(await count(h), before);
    await h.database.prepare('DROP TRIGGER reject_import').run();
    const retry = await h.api('POST', importPath, 'teacher-a', body);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.addedCount, 2);
    assert.equal(await count(h), before + 2);
});