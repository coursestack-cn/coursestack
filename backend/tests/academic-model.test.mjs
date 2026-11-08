import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, setCurrentTerm, doc } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });

test('public course list sorts by course ID before pagination', async () => {
    await h.database.prepare("UPDATE courses SET created_at=created_at-1 WHERE id='course-a'").run();
    const catalog = await h.api('GET', '/courses');
    assert.deepEqual(catalog.data.items.map(course => course.id), ['course-a', 'course-b']);

    const page = await h.api('GET', '/courses?q=course-&page=2&pageSize=1');
    assert.equal(page.data.total, 2);
    assert.deepEqual(page.data.items.map(course => course.id), ['course-b']);
});

test('my course search filters before pagination and keeps current/history membership boundaries', async () => {
    assert.equal((await h.api('GET', '/courses?code=course-a')).status, 400);
    assert.equal((await h.api('GET', '/courses?id=course-a')).data.total, 1);
    assert.equal((await h.api('GET', '/me/courses?q=course-a')).status, 401);
    const physics = await h.api('GET', `/me/courses?pageSize=1&q=${encodeURIComponent('  物理  ')}`, 'student-b');
    assert.equal(physics.status, 200);
    assert.equal(physics.data.total, 1);
    assert.deepEqual(physics.data.items.map(item => item.course.id), ['course-b']);
    assert.equal(physics.data.currentTerm.id, 'term-active');
    assert.equal((await h.api('GET', '/me/courses?q=course-b', 'teacher-a')).data.total, 0);
    assert.equal((await h.api('GET', '/me/courses?q=course-a', 'teacher-b')).data.total, 0);
    const history = await h.api('GET', '/me/courses?scope=history&q=course-a', 'teacher-b');
    assert.equal(history.data.total, 1);
    assert.deepEqual(history.data.items[0].terms.map(term => term.id), ['term-old']);
    assert.equal((await h.api('GET', '/me/courses?q=course-a', 'admin')).data.total, 0);
    assert.equal((await h.api('GET', `/me/courses?q=${'x'.repeat(101)}`, 'teacher-a')).status, 400);
    assert.equal((await h.api('GET', `/me/courses?q=${encodeURIComponent("' OR 1=1 --")}`, 'teacher-a')).data.total, 0);
});

const ownClass = '/courses/course-a/terms/term-active/teachers/teacher-a';
const otherClass = '/courses/course-a/terms/term-active/teachers/teacher-b';

test('admin creates a long-lived course without term or teacher; retries return the course number', async () => {
    await setCurrentTerm(h.database, null);
    const body = { name: '离散数学', id: 'DISCRETE101', introduction: '图论与组合数学' }, key = 'create-course-once';
    for (const who of ['teacher-a', 'student-a']) assert.equal((await h.api('POST', '/courses', who, body)).status, 403);
    const first = await h.api('POST', '/courses', 'admin', body, { key });
    assert.equal(first.status, 201); assert.equal(first.data.id, body.id);
    const replay = await h.api('POST', '/courses', 'admin', body, { key });
    assert.equal(replay.status, 201); assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    assert.equal((await h.api('POST', '/courses', 'admin', { ...body, name: '不同' }, { key })).status, 409);
    assert.equal((await h.api('POST', '/courses', 'admin', body)).status, 409);
    const course = (await h.api('GET', '/courses/DISCRETE101')).data;
    assert.equal(course.currentTerm, null); assert.equal(course.offeredInCurrentTerm, false); assert.deepEqual(course.currentTeachers, []);
    assert.equal('code' in course, false); assert.equal('bonusPolicy' in course, false);
    assert.equal(await h.database.prepare("SELECT count(*) AS n FROM course_terms WHERE course_id='DISCRETE101'").first('n'), 0);
    assert.equal((await h.api('PATCH', '/courses/DISCRETE101', 'teacher-a', { name: '越权' })).status, 403);
    assert.equal((await h.api('PATCH', '/courses/DISCRETE101', 'admin', { id: 'NEW' })).status, 400);
});

test('admin schedules offerings and teachers join only current offerings, independently and idempotently', async () => {
    assert.equal((await h.api('PUT', '/courses/course-b/terms/term-old', 'teacher-a')).status, 403);
    assert.equal((await h.api('PUT', '/courses/course-b/terms/term-old', 'admin')).status, 200);
    assert.equal((await h.api('PUT', '/courses/course-b/terms/term-old/teachers/me', 'teacher-a')).status, 409);
    await h.api('POST', '/courses', 'admin', { id: 'NEW', name: '尚未开课' });
    assert.equal((await h.api('PUT', '/courses/NEW/terms/term-active/teachers/me', 'teacher-a')).status, 409);
    assert.equal((await h.api('PUT', '/courses/NEW/terms/term-active', 'admin')).status, 200);
    const joins = await Promise.all(['teacher-a', 'teacher-b', 'teacher-a'].map(who => h.api('PUT', '/courses/NEW/terms/term-active/teachers/me', who)));
    for (const joined of joins) assert.equal(joined.status, 200, JSON.stringify(joined.data));
    assert.equal(await h.database.prepare("SELECT count(*) AS n FROM teaching_classes WHERE course_id='NEW'").first('n'), 2);
    const course = (await h.api('GET', '/courses/NEW')).data;
    assert.equal(course.offeredInCurrentTerm, true); assert.deepEqual(course.currentTeachers.map(t => t.id).sort(), ['teacher-a', 'teacher-b']);
    assert.equal((await h.api('DELETE', '/courses/NEW/terms/term-active', 'admin')).status, 409);
    assert.equal((await h.api('PUT', '/courses/NEW/terms/term-active/teachers/me', 'student-a')).status, 403);
    assert.equal((await h.api('GET', '/courses?termId=term-old')).data.total, 2);
    assert.equal((await h.api('GET', '/me/courses?q=NEW', 'teacher-b')).data.total, 1);
});

test('semester APIs preserve history, validate unknown targets and revoke former teacher management', async () => {
    const before = (await h.database.prepare('SELECT * FROM teaching_classes ORDER BY course_id,term_id,teacher_id').all()).results;
    assert.equal((await h.api('PUT', '/terms/next', 'teacher-a', { name: '下一学期' })).status, 403);
    assert.equal((await h.api('PUT', '/terms/next', 'admin', { name: '下一学期' })).status, 200);
    assert.equal((await h.api('PUT', '/terms/current', 'admin', { termId: 'missing' })).status, 404);
    assert.equal(await h.database.prepare('SELECT id FROM terms WHERE current=1').first('id'), 'term-active');
    assert.equal((await h.api('PUT', '/terms/current', 'admin', { termId: 'term-old' })).status, 200);
    assert.equal((await h.api('GET', '/courses/course-a/entry', 'teacher-a')).data.permissions.canManageContent, false);
    assert.equal((await h.api('GET', '/courses/course-a/entry', 'teacher-b')).data.permissions.canManageContent, true);
    assert.equal((await h.api('GET', ownClass, 'teacher-a')).status, 403);
    assert.equal((await h.api('GET', ownClass, 'admin')).status, 200);
    assert.deepEqual((await h.database.prepare('SELECT * FROM teaching_classes ORDER BY course_id,term_id,teacher_id').all()).results, before);
    // The current term can be switched back but never cleared.
    assert.equal((await h.api('PUT', '/terms/current', 'admin', { termId: null })).status, 400);
    assert.equal(await h.database.prepare('SELECT id FROM terms WHERE current=1').first('id'), 'term-old');
    assert.equal((await h.api('PUT', '/terms/current', 'admin', { termId: 'term-active' })).status, 200);
    assert.equal((await h.api('GET', '/courses/course-a/entry', 'teacher-a')).data.permissions.canManageContent, true);
});

test('teachers co-manage content but only their own roster, rules and manual awards', async () => {
    assert.equal((await h.api('PUT', '/courses/course-a/terms/term-active/teachers/me', 'teacher-b')).status, 200);
    const rules = { pointsQuestion: 3, pointsAnswer: 7, pointsAcceptance: 11, pointsComment: 1, pointsMaterial: 9, pointsMaterialVersion: 2 };
    assert.equal((await h.api('PUT', `${otherClass}/bonus-policy`, 'teacher-b', rules)).status, 200);
    assert.equal((await h.api('POST', `${otherClass}/students`, 'teacher-b', { schoolNumber: 'visitor' })).status, 200);
    assert.equal((await h.api('POST', `${otherClass}/students`, 'teacher-b', { schoolNumber: 'visitor' })).status, 200);
    assert.equal((await h.api('POST', `${ownClass}/students`, 'teacher-a', { schoolNumber: 'visitor' })).status, 409);
    assert.equal((await h.api('POST', `${ownClass}/students`, 'teacher-a', { schoolNumber: 'missing' })).status, 404);
    for (const route of ['students', 'bonus-ledger', 'bonus-summary']) assert.equal((await h.api('GET', `${otherClass}/${route}`, 'teacher-a')).status, 403);
    assert.equal((await h.api('PUT', `${otherClass}/bonus-policy`, 'teacher-a', rules)).status, 403);
    assert.equal((await h.api('POST', `${ownClass}/bonus-adjustments`, 'teacher-a', { studentId: 'visitor', deltaPoints: 5 })).status, 409);
    const q = await h.postQuestion(), answer = await h.postAnswer(q, 'visitor');
    assert.equal((await h.accept(q, answer, 'teacher-a')).status, 200);
    const ledger = (await h.api('GET', `${otherClass}/bonus-ledger`, 'teacher-b')).data.items;
    assert.deepEqual(ledger.map(r => [r.teacherId, r.deltaPoints]), [['teacher-b', 11], ['teacher-b', 7]]);
    assert.equal((await h.api('GET', `${ownClass}/students`, 'teacher-a')).data.total, 2);
    assert.equal((await h.api('GET', '/teaching-classes', 'teacher-a')).data.total, 1);
    assert.equal((await h.api('GET', '/teaching-classes?courseId=course-a', 'admin')).data.total, 3);
    const question = (await h.api('GET', `/questions/${q}`)).data;
    assert.equal(JSON.stringify(question).includes('schoolNumber'), false);
});

test('admin transfers an enrollment with its scores, deletes the old class, then withdraws the offering', async () => {
    const offering = '/courses/course-a/terms/term-active';
    const transfer = `${ownClass}/students/student-a/transfer`, target = { targetTeacherId: 'teacher-b' };
    const manual = (path, studentId, deltaPoints) => h.api('POST', `${path}/bonus-adjustments`, 'admin', { studentId, deltaPoints, reason: '课堂练习' });
    const ledger = async (id) => (await h.database.prepare("SELECT * FROM bonus_ledger WHERE student_id=? ORDER BY id").bind(id).all()).results;
    const notices = async (id) => (await h.database.prepare("SELECT * FROM notifications WHERE account_id=? AND kind='bonus' ORDER BY id").bind(id).all()).results;
    const question = await h.postQuestion();
    await h.policy({ pointsQuestion: 3 });
    const scoredQuestion = await h.postQuestion();
    assert.equal((await h.api('PUT', `/contents/${scoredQuestion}/moderation`, 'teacher-a', { action: 'hide' })).status, 200);
    assert.equal((await manual(ownClass, 'student-a', 7)).status, 201);
    assert.equal((await manual(ownClass, 'student-b', 4)).status, 201);
    const otherCourse = '/courses/course-b/terms/term-active/teachers/teacher-b';
    assert.equal((await manual(otherCourse, 'student-b', 11)).status, 201);
    assert.equal((await h.api('PUT', transfer, 'admin', target)).status, 404);
    await h.api('PUT', `${offering}/teachers/me`, 'teacher-b');
    const before = await ledger('student-a'), originalNotices = await notices('student-a');
    assert.deepEqual(before.map(row => row.delta_points), [3,-3,7]);
    assert.equal(before[1].reverses_id, before[0].id);
    assert.equal(originalNotices.length, 2);
    for (const who of ['teacher-a','teacher-b','student-a']) {
        assert.equal((await h.api('PUT', transfer, who, target)).status, 403);
        assert.equal((await h.api('DELETE', ownClass, who)).status, 403);
    }
    // Historical classes remain editable by the administrator.
    await setCurrentTerm(h.database, 'term-old');
    assert.equal((await h.api('DELETE', `${ownClass}/students/student-a`, 'teacher-a')).status, 403);
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await h.api('PUT', transfer, 'admin', target)).status, 200);
    const moved = before.map(row => ({ ...row, teacher_id: 'teacher-b' }));
    assert.deepEqual(await ledger('student-a'), moved);
    assert.deepEqual(await notices('student-a'), originalNotices);
    assert.deepEqual((await h.api('GET', `${otherClass}/students`, 'admin')).data.items.map(s => [s.studentId,s.totalPoints]), [['student-a',7]]);
    assert.equal((await h.api('PUT', `${ownClass}/students/student-a/transfer`, 'admin', { targetTeacherId: 'teacher-a' })).status, 409);
    assert.equal((await h.api('DELETE', `${ownClass}/students/student-a`, 'admin')).status, 200);
    assert.equal((await h.api('DELETE', offering, 'admin')).status, 409);
    assert.equal((await h.api('DELETE', ownClass, 'admin')).status, 200);
    assert.equal((await h.api('DELETE', ownClass, 'admin')).status, 200);
    assert.deepEqual(await ledger('student-a'), moved);
    assert.deepEqual(await notices('student-a'), originalNotices);
    const remaining = await ledger('student-b');
    assert.deepEqual(remaining.map(row => [row.course_id,row.delta_points]), [['course-b',11]]);
    assert.deepEqual((await notices('student-b')).map(row => row.source_id), [String(remaining[0].id)]);
    assert.equal((await h.api('GET', ownClass, 'admin')).status, 404);
    assert.equal((await h.api('GET', `/questions/${question}`)).status, 200);
    assert.equal((await h.api('PUT', transfer, 'admin', target)).status, 200);
    assert.equal((await h.api('DELETE', otherClass, 'admin')).status, 200);
    assert.deepEqual(await ledger('student-a'), []);
    assert.equal((await h.api('DELETE', offering, 'admin')).status, 200);
    assert.deepEqual((await h.api('GET', '/courses/course-a/terms')).data.map(t => t.id), ['term-old']);
    assert.deepEqual((await h.database.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('teachers may remove only their own current students and adding never transfers a student', async () => {
    await h.api('PUT', '/courses/course-a/terms/term-active/teachers/me', 'teacher-b');
    const member = `${ownClass}/students/student-a`;
    await h.policy({ pointsQuestion: 3 });
    const q = await h.postQuestion();
    assert.equal((await h.api('POST', `${otherClass}/students`, 'teacher-b', { schoolNumber: 'student-a' })).status, 409);
    for (const who of ['teacher-b', 'student-a']) assert.equal((await h.api('DELETE', member, who)).status, 403);
    assert.equal((await h.api('DELETE', member, 'teacher-a')).status, 200);
    assert.equal((await h.api('DELETE', member, 'teacher-a')).status, 200);
    assert.equal((await h.api('GET', '/me/bonus-ledger', 'student-a')).data.total, 0);
    assert.equal((await h.api('GET', `/questions/${q}`)).status, 200);
    assert.equal((await h.api('POST', `${otherClass}/students`, 'teacher-b', { schoolNumber: 'student-a' })).status, 200);
    assert.equal((await h.api('GET', `${otherClass}/students`, 'teacher-b')).data.items[0].totalPoints, 0);
});

test('tags are nullable and only questions/materials may store a JSON array', async () => {
    const q = await h.postQuestion('student-a', { tags: ['标签'] }), a = await h.postAnswer(q);
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'question', targetId: q, body: doc('评论') });
    for (const id of [a, comment.data.id]) {
        assert.equal((await h.api('GET', `/contents/${id}`)).data.tags, null);
        for (const tags of ['[]', '["标签"]']) await assert.rejects(() => h.database.prepare('UPDATE contents SET tags=? WHERE id=?').bind(tags, id).run(), /contents_tags/);
    }
    for (const id of [q, 'material-a']) {
        const changed = await h.api('PATCH', `/contents/${id}`, 'student-a', { tags: null });
        assert.equal(changed.status, 200); assert.equal(changed.data.tags, null);
        await assert.rejects(() => h.database.prepare("UPDATE contents SET tags='{}' WHERE id=?").bind(id).run(), /contents_tags/);
    }
});

test('moderation explanations and score revocations roll back with failed mutations', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    const count = await h.database.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n');
    await h.database.prepare("CREATE TRIGGER fail_content_update BEFORE UPDATE ON contents BEGIN SELECT RAISE(ABORT,'simulated_failure'); END").run();
    assert.equal((await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { action: 'hide', reason: '广告需要下架' })).status, 500);
    assert.equal(await h.database.prepare('SELECT count(*) AS n FROM moderation_actions').first('n'), 0);
    assert.equal(await h.database.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n'), count);
    await h.database.prepare('DROP TRIGGER fail_content_update').run();
    assert.equal((await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { action: 'hide', reason: '广告需要下架' })).status, 200);
    assert.equal(await h.database.prepare('SELECT reason FROM moderation_actions').first('reason'), '广告需要下架');
    assert.equal(await h.database.prepare('SELECT reason FROM bonus_ledger ORDER BY id DESC LIMIT 1').first('reason'), null);
    assert.equal((await h.database.prepare('PRAGMA table_info(contents)').all()).results.some(c => c.name === 'change_reason'), false);
});