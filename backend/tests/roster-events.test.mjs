import assert from 'node:assert/strict';
import { test } from 'node:test';
import { start, setCurrentTerm } from './discussions-helpers.mjs';

const classA = '/courses/course-a/terms/term-active/teachers/teacher-a';
const classB = '/courses/course-a/terms/term-active/teachers/teacher-b';
async function setup(t) {
    const h = await start();
    t.after(() => h.dispose());
    await h.database.batch(['x', 'y'].map(id => h.database.prepare("INSERT INTO accounts(id,role,school_number) VALUES (?,'student',?)").bind(`student-${id}`, `number-${id}`)));
    return h;
}
const events = async h => (await h.database.prepare(`SELECT action,course_id,term_id,teacher_id,student_id,target_teacher_id,operator_id
    FROM class_roster_events ORDER BY id`).all()).results.map(r => [r.action, r.teacher_id, r.student_id, r.target_teacher_id, r.operator_id]);

test('every roster change is recorded once with its operator; retries and no-ops add nothing', async t => {
    const h = await setup(t);
    for (let i = 0; i < 2; i++) {
        assert.equal((await h.api('POST', `${classA}/students`, 'teacher-a', { schoolNumber: 'number-x' })).status, 200);
        const imported = await h.api('POST', `${classA}/students/import`, 'teacher-a', { schoolNumbers: ['number-y', 'missing'] });
        assert.equal(imported.status, 200);
        assert.equal(imported.data.addedCount, i ? 0 : 1);
        assert.equal((await h.api('PUT', '/courses/course-a/terms/term-active/teachers/me', 'teacher-b')).status, 200);
        assert.equal((await h.api('PUT', `${classA}/students/student-b/transfer`, 'admin', { targetTeacherId: 'teacher-b' })).status, 200);
        assert.equal((await h.api('DELETE', `${classA}/students/student-a`, 'teacher-a')).status, 200);
    }
    assert.equal((await h.api('DELETE', classB, 'admin')).status, 200);
    assert.deepEqual(await events(h), [
        ['student_added', 'teacher-a', 'student-x', null, 'teacher-a'],
        ['student_added', 'teacher-a', 'student-y', null, 'teacher-a'],
        ['class_created', 'teacher-b', null, null, 'teacher-b'],
        ['student_transferred', 'teacher-a', 'student-b', 'teacher-b', 'admin'],
        ['student_removed', 'teacher-a', 'student-a', null, 'teacher-a'],
        // Deleting a class records the students it still held, then the class itself.
        ['student_removed', 'teacher-b', 'student-b', null, 'admin'],
        ['class_deleted', 'teacher-b', null, null, 'admin'],
    ]);
    // The enrollments are gone, but their history stays.
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM class_students WHERE student_id IN ('student-a','student-b') AND course_id='course-a'").first('n'), 0);
});

test('rejected or rolled-back changes leave no record', async t => {
    const h = await setup(t);
    await h.database.prepare("INSERT INTO teaching_classes VALUES('course-a','term-active','teacher-b')").run();
    await h.database.prepare("INSERT INTO class_students VALUES('course-a','term-active','student-x','teacher-b')").run();
    assert.equal((await h.api('POST', `${classA}/students`, 'teacher-a', { schoolNumber: 'number-x' })).status, 409);
    const imported = await h.api('POST', `${classA}/students/import`, 'teacher-a', { schoolNumbers: ['number-x'] });
    assert.equal(imported.data.failedCount, 1);
    assert.equal((await h.api('POST', `${classB}/students`, 'teacher-a', { schoolNumber: 'number-y' })).status, 403);
    assert.equal((await h.api('DELETE', `${classB}/students/student-x`, 'teacher-a')).status, 403);
    assert.equal((await h.api('DELETE', classB, 'teacher-a')).status, 403);
    // Already in the target class: an idempotent success without a change to record.
    assert.equal((await h.api('PUT', `${classA}/students/student-b/transfer`, 'admin', { targetTeacherId: 'teacher-a' })).status, 200);
    assert.equal((await h.api('PUT', `${classB}/students/student-a/transfer`, 'admin', { targetTeacherId: 'teacher-b' })).status, 409);
    assert.equal((await h.api('PUT', `${classA}/students/student-a/transfer`, 'admin', { targetTeacherId: 'missing' })).status, 404);
    // Without a current term the insert is refused, and the record written in the same batch rolls back with it.
    await h.database.prepare("UPDATE terms SET current=0").run();
    assert.equal((await h.api('POST', `${classA}/students`, 'admin', { schoolNumber: 'number-y' })).status, 409);
    await setCurrentTerm(h.database, 'term-active');
    await h.database.prepare("UPDATE accounts SET status='deleted' WHERE id='teacher-b'").run();
    await assert.rejects(h.database.batch([
        h.database.prepare(`INSERT INTO class_roster_events(action,course_id,term_id,teacher_id,operator_id)
            VALUES('class_created','course-a','term-active','teacher-a','admin')`),
        h.database.prepare("INSERT INTO teaching_classes VALUES('course-b','term-active','teacher-b')"),
    ]), /invalid_class_teacher/);
    assert.deepEqual(await events(h), []);
});

test('records are append-only and keep a consistent shape', async t => {
    const h = await setup(t);
    await h.api('POST', `${classA}/students`, 'teacher-a', { schoolNumber: 'number-x' });
    await assert.rejects(h.database.prepare("UPDATE class_roster_events SET operator_id='admin'").run(), /immutable_roster_event/);
    await assert.rejects(h.database.prepare('DELETE FROM class_roster_events').run(), /immutable_roster_event/);
    for (const [action, student, target] of [['class_created', 'student-x', null], ['student_added', null, null],
        ['student_removed', 'student-x', 'teacher-b'], ['student_transferred', 'student-x', null], ['student_transferred', 'student-x', 'teacher-a'], ['renamed', null, null]]) {
        await assert.rejects(h.database.prepare(`INSERT INTO class_roster_events(action,course_id,term_id,teacher_id,student_id,target_teacher_id,operator_id)
            VALUES(?,'course-a','term-active','teacher-a',?,?,'admin')`).bind(action, student, target).run(), /CHECK constraint failed/, action);
    }
    assert.equal((await events(h)).length, 1);
});

test('only administrators read the history, filtered by course, term, teacher or student', async t => {
    const h = await setup(t);
    await h.api('POST', `${classA}/students`, 'teacher-a', { schoolNumber: 'number-x' });
    await h.api('PUT', '/courses/course-a/terms/term-active/teachers/me', 'teacher-b');
    await h.api('PUT', `${classA}/students/student-x/transfer`, 'admin', { targetTeacherId: 'teacher-b' });
    await h.database.prepare("UPDATE accounts SET status='deleted' WHERE id='student-x'").run();
    for (const as of ['teacher-a', 'student-a', null]) {
        assert.equal((await h.api('GET', '/admin/roster-events', as)).status, as ? 403 : 401);
    }
    const all = await h.api('GET', '/admin/roster-events?pageSize=2', 'admin');
    assert.equal(all.status, 200);
    assert.deepEqual({ ...all.data, items: all.data.items.map(item => item.action) },
        { items: ['student_transferred', 'class_created'], page: 1, pageSize: 2, total: 3 });
    assert.deepEqual(all.data.items[0], {
        id: 3, action: 'student_transferred', course: { id: 'course-a', name: '高等数学' }, term: { id: 'term-active', name: '当前学期' },
        teacher: { id: 'teacher-a', nickname: '数学教师', isDeleted: false }, targetTeacher: { id: 'teacher-b', nickname: '物理教师', isDeleted: false },
        student: { id: 'student-x', schoolNumber: 'number-x', name: null, isDeleted: true },
        operator: { id: 'admin', nickname: '管理员', isDeleted: false, role: 'admin' }, createdAt: all.data.items[0].createdAt,
    });
    const actions = async query => (await h.api('GET', `/admin/roster-events?${query}`, 'admin')).data.items.map(item => item.action);
    assert.deepEqual(await actions('teacherId=teacher-b'), ['student_transferred', 'class_created']);
    assert.deepEqual(await actions('studentId=student-x'), ['student_transferred', 'student_added']);
    assert.deepEqual(await actions('courseId=course-a&termId=term-active'), ['student_transferred', 'class_created', 'student_added']);
    assert.deepEqual(await actions('termId=term-old'), []);
});