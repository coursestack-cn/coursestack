import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, setCurrentTerm } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const classPath = '/courses/course-a/terms/term-active/teachers/teacher-a';
const adjust = (deltaPoints, key = crypto.randomUUID()) => h.api('POST', `${classPath}/bonus-adjustments`, 'teacher-a',
    { studentId: 'student-b', deltaPoints, reason: '课堂贡献' }, { key });

test('student rules use the signed-in student and current class without disclosing roster information', async () => {
    await h.policy({ pointsQuestion: 3, pointsAnswer: 5, pointsAcceptance: 20, pointsComment: 1, pointsMaterial: 10, pointsMaterialVersion: 2 });
    await h.database.prepare("INSERT INTO teaching_classes VALUES('course-a','term-active','teacher-b')").run();
    await h.database.prepare("INSERT INTO class_students VALUES('course-a','term-active','visitor','teacher-b')").run();
    await h.database.prepare("UPDATE class_bonus_rules SET points_answer=99 WHERE teacher_id='teacher-b' AND term_id='term-active'").run();
    const result = await h.api('GET', '/me/bonus-policy?courseId=course-a&studentId=visitor&teacherId=teacher-b', 'student-b');
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.currentTerm, { id: 'term-active', name: '当前学期' });
    assert.deepEqual(result.data.membership.teacher, { id: 'teacher-a', nickname: '数学教师', isDeleted: false });
    assert.deepEqual(result.data.membership.bonusPolicy, {
        pointsQuestion: 3, pointsAnswer: 5, pointsAcceptance: 20, pointsComment: 1, pointsMaterial: 10, pointsMaterialVersion: 2,
    });
    assert.deepEqual(Object.keys(result.data.membership).sort(), ['bonusPolicy', 'teacher']);
    assert.equal((await h.api('GET', '/me/bonus-policy?courseId=course-a', 'visitor')).data.membership.bonusPolicy.pointsAnswer, 99);
    assert.equal((await h.api('GET', '/me/bonus-policy?courseId=course-b', 'student-a')).data.membership, null);
    for (const as of ['teacher-a', 'admin']) assert.equal((await h.api('GET', '/me/bonus-policy?courseId=course-a', as)).status, 403);
    await setCurrentTerm(h.database, 'term-old');
    assert.equal((await h.api('GET', '/me/bonus-policy?courseId=course-a', 'student-b')).data.membership, null);
    await h.database.prepare('UPDATE terms SET current=0').run();
    assert.deepEqual((await h.api('GET', '/me/bonus-policy?courseId=course-a', 'student-b')).data,
        { courseId: 'course-a', currentTerm: null, membership: null });
});

test('personal history totals include all matching pages, deductions and historical terms, with account isolation', async () => {
    await adjust(10); await adjust(-3); await adjust(2);
    await h.api('POST', '/courses/course-b/terms/term-active/teachers/teacher-b/bonus-adjustments', 'teacher-b', { studentId: 'student-b', deltaPoints: 40 });
    await setCurrentTerm(h.database, 'term-old');
    await h.database.prepare("INSERT INTO class_students VALUES('course-a','term-old','student-b','teacher-b')").run();
    await h.api('POST', '/courses/course-a/terms/term-old/teachers/teacher-b/bonus-adjustments', 'admin', { studentId: 'student-b', deltaPoints: 7 });
    await setCurrentTerm(h.database, 'term-active');
    const result = await h.api('GET', '/me/bonus-ledger?courseId=course-a&termId=term-active&pageSize=1&page=2', 'student-b');
    assert.equal(result.status, 200); assert.equal(result.data.total, 3); assert.equal(result.data.totalPoints, 9);
    assert.equal(result.data.items.length, 1); assert.equal(result.data.items[0].deltaPoints, -3);
    assert.equal(result.data.items[0].courseName, '高等数学'); assert.equal(result.data.items[0].termName, '当前学期');
    assert.equal(result.data.items[0].reason, '课堂贡献');
    assert.equal((await h.api('GET', '/me/bonus-ledger?courseId=course-a', 'student-b')).data.totalPoints, 16);
    assert.equal((await h.api('GET', '/me/bonus-ledger', 'student-b')).data.totalPoints, 56);
    const other = await h.api('GET', '/me/bonus-ledger?studentId=student-b', 'student-a');
    assert.equal(other.data.total, 0); assert.equal(other.data.totalPoints, 0); assert.deepEqual(other.data.items, []);
});

test('incremental notifications page in ledger order and contain awards, reversals and restorations only for the viewer', async () => {
    const initial = await h.api('GET', '/me/bonus-events', 'student-b');
    assert.deepEqual(initial.data, { items: [], nextCursor: 0, hasMore: false });
    await h.policy({ pointsAnswer: 5, pointsAcceptance: 20, pointsQuestion: 2 });
    const question = await h.postQuestion(), answer = await h.postAnswer(question);
    await h.accept(question, answer); await h.accept(question, null); await h.accept(question, answer);
    await adjust(3, 'notification-manual'); await adjust(3, 'notification-manual');
    let cursor = initial.data.nextCursor;
    const received = [];
    do {
        const response = await h.api('GET', `/me/bonus-events?afterId=${cursor}&pageSize=2&studentId=student-a`, 'student-b');
        assert.equal(response.status, 200);
        assert.ok(response.data.items.every(record => record.studentId === 'student-b' && record.id > cursor));
        received.push(...response.data.items);
        cursor = response.data.nextCursor;
        if (!response.data.hasMore) break;
    } while (received.length < 20);
    assert.deepEqual(received.map(record => record.deltaPoints), [5, 20, -20, 20, 3]);
    assert.ok(received.every((record, index) => index === 0 || received[index - 1].id < record.id));
    assert.equal(received[2].reversesId, received[1].id); assert.equal(received[3].reversesId, received[2].id);
    assert.equal(received[0].courseName, '高等数学'); assert.equal(received[0].termName, '当前学期');
    assert.deepEqual((await h.api('GET', `/me/bonus-events?afterId=${cursor}`, 'student-b')).data,
        { items: [], nextCursor: cursor, hasMore: false });
    const baseline = await h.api('GET', '/me/bonus-events', 'student-b');
    assert.deepEqual(baseline.data, { items: [], nextCursor: cursor, hasMore: false });
    const other = await h.api('GET', '/me/bonus-events?afterId=0&studentId=student-b', 'student-a');
    assert.equal(other.data.items.length, 1); assert.equal(other.data.items[0].studentId, 'student-a');
});

test('bonus reads require a session and reject malformed filters or cursors', async () => {
    for (const path of ['/me/bonus-policy?courseId=course-a', '/me/bonus-ledger', '/me/bonus-events']) {
        assert.equal((await h.api('GET', path)).status, 401);
    }
    for (const value of ['', '-1', '1.5', '1e3', 'invalid', '9007199254740992']) {
        assert.equal((await h.api('GET', `/me/bonus-events?afterId=${value}`, 'student-b')).status, 400);
    }
    for (const value of [0, 51, 1.5]) assert.equal((await h.api('GET', `/me/bonus-events?pageSize=${value}`, 'student-b')).status, 400);
    assert.equal((await h.api('GET', '/me/bonus-policy', 'student-b')).status, 400);
    assert.equal((await h.api('GET', '/me/bonus-policy?courseId=missing', 'student-b')).status, 404);
    assert.equal((await h.api('GET', '/me/bonus-ledger?termId=%2F', 'student-b')).status, 400);
    assert.equal((await h.api('GET', '/me/bonus-ledger?courseId=..', 'student-b')).status, 400);
});

test('class roster totals include all ledger entries, zero balances and deductions without crossing class or term boundaries', async () => {
    await h.policy({ pointsQuestion: 4 });
    const question = await h.postQuestion('student-b');
    await adjust(10); await adjust(-3);
    await h.api('POST', '/courses/course-b/terms/term-active/teachers/teacher-b/bonus-adjustments', 'teacher-b',
        { studentId: 'student-b', deltaPoints: 40 });
    await setCurrentTerm(h.database, 'term-old');
    await h.database.prepare("INSERT INTO teaching_classes VALUES('course-a','term-old','teacher-a')").run();
    await h.database.prepare("INSERT INTO class_students VALUES('course-a','term-old','student-b','teacher-a')").run();
    await h.api('POST', '/courses/course-a/terms/term-old/teachers/teacher-a/bonus-adjustments', 'admin',
        { studentId: 'student-b', deltaPoints: 7 });
    await setCurrentTerm(h.database, 'term-active');

    const first = await h.api('GET', `${classPath}/students?pageSize=1`, 'teacher-a');
    assert.equal(first.status, 200); assert.equal(first.data.total, 2);
    assert.deepEqual(first.data.items.map(({ studentId, totalPoints }) => ({ studentId, totalPoints })),
        [{ studentId: 'student-a', totalPoints: 0 }]);
    const second = await h.api('GET', `${classPath}/students?pageSize=1&page=2`, 'teacher-a');
    assert.equal(second.status, 200); assert.equal(second.data.total, 2);
    assert.deepEqual(second.data.items.map(({ studentId, totalPoints }) => ({ studentId, totalPoints })),
        [{ studentId: 'student-b', totalPoints: 11 }]);

    assert.equal((await h.api('DELETE', `/contents/${question}`, 'student-b')).status, 200);
    assert.equal((await h.api('GET', `${classPath}/students?pageSize=1&page=2`, 'teacher-a')).data.items[0].totalPoints, 7);
    await adjust(-12);
    const roster = await h.api('GET', `${classPath}/students`, 'admin');
    assert.equal(roster.data.items.find(student => student.studentId === 'student-b').totalPoints, -5);
    const historical = await h.api('GET', '/courses/course-a/terms/term-old/teachers/teacher-a/students', 'admin');
    assert.equal(historical.data.items[0].totalPoints, 7);
    assert.equal((await h.api('GET', '/courses/course-a/terms/term-old/teachers/teacher-a/students', 'teacher-a')).status, 403);
    for (const as of ['student-a', 'teacher-b']) {
        assert.equal((await h.api('GET', `${classPath}/students`, as)).status, 403);
    }
    assert.equal((await h.api('GET', `${classPath}/students`)).status, 401);
});