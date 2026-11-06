import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, setCurrentTerm, doc, tokenFor } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const moderate = (id, action, as = 'teacher-a') => h.api('PUT', `/contents/${id}/moderation`, as, { action, reason: '内容审查测试理由' });
const balance = (student, term) => h.database.prepare('SELECT COALESCE(SUM(delta_points),0) AS n FROM bonus_ledger WHERE student_id=? AND term_id=?').bind(student, term).first('n');

test('owners retain private maintenance; managers share review and audited deletion across classes but never edit others content', async () => {
    await h.database.prepare("INSERT INTO teaching_classes VALUES('course-a','term-active','teacher-b')").run();
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    assert.equal((await h.accept(q, a, 'teacher-b')).status, 200);
    for (const as of ['teacher-a', 'teacher-b', 'admin', 'student-b']) {
        assert.equal((await h.api('PATCH', `/contents/${q}`, as, { body: doc('未经作者许可的修改') })).status, 403);
        assert.equal((await h.api('DELETE', `/contents/${q}`, as)).status, 403);
    }
    assert.equal((await moderate(q, 'hide', 'student-a')).status, 403);
    assert.equal((await moderate(q, 'hide', 'teacher-b')).status, 200);
    for (const as of [undefined, 'student-b', 'teacher-a', 'teacher-b', 'admin']) assert.equal((await h.api('GET', `/questions/${q}`, as)).status, 404);
    const own = await h.api('GET', `/questions/${q}`, 'student-a');
    assert.equal(own.status, 200); assert.equal(own.data.status, 'hidden'); assert.equal(own.data.isPublic, false);
    const edited = await h.api('PATCH', `/contents/${q}`, 'student-a', { body: doc('修订后的正文') });
    assert.equal(edited.status, 200); assert.equal(edited.data.status, 'hidden');
    const review = await h.api('GET', `/moderation/contents/${q}`, 'teacher-b');
    assert.deepEqual(review.data.body, doc('修订后的正文'));
    assert.ok((await h.api('GET', '/moderation/contents?courseId=course-a', 'teacher-b')).data.items.some(item => item.id === q));
    assert.equal((await h.api('GET', `/moderation/contents/${q}`, 'student-a')).status, 404);
    assert.equal((await h.api('GET', '/me/activity?kind=question', 'student-a')).data.items[0].id, q);
    assert.equal((await h.api('GET', `/me/contents/${a}`, 'student-a')).status, 403);
    assert.equal((await h.api('GET', `/contents/${a}`, 'student-b')).data.isPublic, false);
    assert.equal((await h.api('PATCH', `/contents/${a}`, 'student-b', { body: doc('隐藏分支内自己的回答') })).status, 200);
    assert.equal((await h.api('DELETE', `/contents/${a}`, 'student-b')).status, 409);
    assert.equal((await moderate(a, 'delete', 'teacher-b')).status, 200);
    assert.equal((await moderate(q, 'restore', 'teacher-b')).status, 200);
    assert.deepEqual((await h.api('GET', `/questions/${q}`)).data.body, doc('修订后的正文'));
    await moderate(q, 'hide');
    assert.equal((await h.api('DELETE', `/contents/${q}`, 'student-a')).status, 200);
    assert.equal((await moderate(q, 'restore')).status, 409);
    assert.equal((await h.api('GET', `/me/contents/${q}`, 'student-a')).data.body, null);
});

test('report outcomes are atomic and notices are private, durable and idempotently readable', async () => {
    await h.policy({ pointsQuestion: 5 });
    const q = await h.postQuestion();
    const first = await h.api('POST', `/contents/${q}/reports`, 'student-b', { reason: '请核对这个内容' });
    const path = `/moderation/reports/${first.data.id}`;
    assert.equal((await h.api('PATCH', path, 'teacher-b', { action: 'hide', resolution: '无此课程管理权限' })).status, 403);
    await h.database.prepare("CREATE TRIGGER fail_points BEFORE INSERT ON bonus_ledger BEGIN SELECT RAISE(ABORT,'test_failure'); END").run();
    assert.equal((await h.api('PATCH', path, 'teacher-a', { action: 'hide', resolution: '请作者核实后修改' })).status, 500);
    assert.equal((await h.api('GET', `/questions/${q}`)).status, 200);
    assert.equal((await h.api('GET', '/moderation/reports', 'teacher-a')).data.items[0].status, 'pending');
    assert.equal((await h.api('GET', '/notifications', 'student-a')).data.items.length, 0);
    await h.database.prepare('DROP TRIGGER fail_points').run();
    assert.equal((await h.api('PATCH', path, 'teacher-a', { action: 'none', resolution: '内容符合发布要求' })).status, 200);
    assert.equal((await h.api('GET', `/questions/${q}`)).status, 200);
    assert.equal((await h.api('GET', '/notifications', 'student-a')).data.items.length, 0);
    const second = await h.api('POST', `/contents/${q}/reports`, 'student-b', { reason: '补充新的举报依据' });
    const secondPath = `/moderation/reports/${second.data.id}`;
    assert.equal((await h.api('PATCH', secondPath, 'teacher-a', { action: 'hide', resolution: '下架等待作者修订' })).status, 200);
    assert.equal(await balance('student-a', 'term-active'), 0);
    assert.equal((await h.api('PATCH', secondPath, 'teacher-a', { action: 'hide', resolution: '下架等待作者修订' })).status, 409);
    const notifications = await h.api('GET', '/notifications', 'student-a');
    assert.equal(notifications.data.items.length, 2); assert.equal(notifications.data.unreadCount, 2);
    const notice = notifications.data.items.find(n => n.type === 'moderation');
    assert.equal(notice.contentId, q); assert.equal(notice.reason, '下架等待作者修订'); assert.equal('reporterId' in notice, false);
    assert.equal((await h.api('GET', '/notifications', 'student-b')).data.items.length, 0);
    assert.equal((await h.api('PUT', `/notifications/${notice.id}/read`, 'student-b')).status, 404);
    for (let i = 0; i < 2; i++) assert.equal((await h.api('PUT', `/notifications/${notice.id}/read`, 'student-a')).status, 200);
    const remaining = (await h.api('GET', '/notifications', 'student-a')).data;
    assert.equal(remaining.unreadCount, 1); assert.equal(remaining.items[0].type, 'bonus');
    await moderate(q, 'restore'); await moderate(q, 'restore');
    const restored = await h.api('GET', '/notifications?status=all', 'student-a');
    assert.equal(restored.data.items.length, 4); assert.equal(restored.data.unreadCount, 3);
    assert.equal(restored.data.items.find(n => n.type === 'moderation').status, 'visible');
    assert.equal((await h.api('GET', '/notifications')).status, 401);
});

test('restoration recalculates each descendant in its own ended term and preserves manual adjustments', async () => {
    await setCurrentTerm(h.database, 'term-old');
    await h.database.prepare("UPDATE class_bonus_rules SET points_question=5 WHERE course_id='course-a' AND term_id='term-old'").run();
    const q = await h.postQuestion('visitor');
    await setCurrentTerm(h.database, 'term-active');
    await h.policy({ pointsAnswer: 20, pointsComment: 2, pointsAcceptance: 4 });
    const a = await h.postAnswer(q);
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'answer', targetId: a, body: doc('评论') });
    const child = await h.api('POST', '/comments', 'student-b', { targetKind: 'comment', targetId: comment.data.id, body: doc('子评论') });
    await h.accept(q, a);
    await h.api('POST', '/courses/course-a/terms/term-active/teachers/teacher-a/bonus-adjustments', 'teacher-a', { studentId: 'student-b', deltaPoints: 9 });
    assert.equal(await balance('student-b', 'term-active'), 37);
    await moderate(q, 'hide');
    assert.equal(await balance('visitor', 'term-old'), 0); assert.equal(await balance('student-b', 'term-active'), 9);
    await moderate(child.data.id, 'hide');
    await h.database.prepare("UPDATE class_bonus_rules SET points_question=11 WHERE course_id='course-a' AND term_id='term-old'").run();
    await h.policy({ pointsAnswer: 30, pointsComment: 6, pointsAcceptance: 40 });
    await h.database.prepare("INSERT INTO terms(id,name) VALUES('future','新学期')").run();
    await setCurrentTerm(h.database, 'future');
    assert.equal((await moderate(q, 'restore', 'teacher-a')).status, 403);
    assert.equal((await moderate(q, 'restore', 'admin')).status, 200);
    assert.equal(await balance('visitor', 'term-old'), 11);
    assert.equal(await balance('student-b', 'term-active'), 85);
    assert.equal(await balance('student-b', 'future'), 0);
    await moderate(child.data.id, 'restore', 'admin');
    assert.equal(await balance('student-b', 'term-active'), 91);
    const before = await h.database.prepare('SELECT COUNT(*) AS n FROM bonus_ledger').first('n');
    await moderate(q, 'restore', 'admin');
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM bonus_ledger').first('n'), before);
    await moderate(q, 'hide', 'admin');
    assert.equal(await balance('student-b', 'term-active'), 9); assert.equal(await balance('visitor', 'term-old'), 0);
    assert.deepEqual((await h.database.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('a zero-value restoration stays zero during unrelated awards, and nested branches never reactivate early', async () => {
    await h.policy({ pointsQuestion: 5, pointsAnswer: 3 });
    const q = await h.postQuestion(), other = await h.postQuestion(), a = await h.postAnswer(q);
    await moderate(q, 'hide'); await moderate(other, 'hide'); await moderate(a, 'hide');
    await h.policy({ pointsQuestion: 0, pointsAnswer: 0 });
    await moderate(q, 'restore');
    assert.equal(await balance('student-a', 'term-active'), 0);
    await h.policy({ pointsQuestion: 10, pointsAnswer: 8 });
    await h.postQuestion();
    assert.equal(await balance('student-a', 'term-active'), 10);
    await moderate(other, 'restore');
    assert.equal(await balance('student-a', 'term-active'), 20);
    assert.equal(await balance('student-b', 'term-active'), 0);
    await moderate(q, 'restore');
    assert.equal(await balance('student-a', 'term-active'), 20);
    await moderate(q, 'hide'); await moderate(q, 'restore');
    assert.equal(await balance('student-a', 'term-active'), 30);
    await moderate(a, 'restore');
    assert.equal(await balance('student-b', 'term-active'), 8);
});

test('hidden material files are available only to the owner or through the manager review endpoint', async () => {
    await h.env.FILES.put('fixtures/material-a/1', new TextEncoder().encode('%PDF-1.7'));
    await moderate('material-a', 'hide');
    const file = async (path, as, method = 'GET') => h.worker.fetch(`http://localhost/api${path}`, { method,
        headers: { Cookie: `coursestack_session=${tokenFor(as)}`, Range: 'bytes=0-4' } });
    for (const method of ['GET', 'HEAD']) {
        assert.equal((await file('/materials/material-a/versions/1/preview', 'student-b', method)).status, 404);
        assert.equal((await file('/materials/material-a/versions/1/preview', 'teacher-a', method)).status, 404);
        assert.equal((await file('/materials/material-a/versions/1/preview', 'student-a', method)).status, method === 'GET' ? 206 : 200);
        assert.equal((await file('/moderation/materials/material-a/versions/1/preview', 'teacher-a', method)).status, method === 'GET' ? 206 : 200);
        assert.equal((await file('/moderation/materials/material-a/versions/1/preview', 'student-a', method)).status, 403);
    }
    assert.equal((await h.api('DELETE', '/materials/material-a/versions/1', 'admin', { reason: '长'.repeat(1001) })).status, 400);
    assert.equal((await h.api('DELETE', '/materials/material-a/versions/1', 'student-a')).status, 200);
});

test('reasons are optional for reports and management actions, and blank reasons still notify owners', async () => {
    const q = await h.postQuestion();
    const report = await h.api('POST', `/contents/${q}/reports`, 'student-b', {});
    assert.equal(report.status, 201);
    assert.equal((await h.api('GET', '/moderation/reports', 'teacher-a')).data.items[0].reason, '');
    assert.equal((await h.api('PATCH', `/moderation/reports/${report.data.id}`, 'teacher-a', { action: 'hide' })).status, 200);
    const hidden = (await h.api('GET', '/notifications', 'student-a')).data.items[0];
    assert.equal(hidden.contentId, q); assert.equal(hidden.status, 'hidden'); assert.equal(hidden.reason, '');
    assert.equal((await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'restore', reason: '   ' })).status, 200);
    assert.equal((await h.api('GET', `/moderation/contents/${q}`, 'teacher-a')).data.actions[0].reason, '');
    assert.equal((await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide', reason: '长'.repeat(1001) })).status, 400);
    assert.equal((await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide', reason: '长'.repeat(1000) })).status, 200);
    assert.equal((await h.api('DELETE', '/materials/material-a/versions/1', 'admin')).status, 200);
    const removed = (await h.api('GET', '/notifications', 'student-a')).data.items[0];
    assert.equal(removed.contentId, 'material-a'); assert.equal(removed.version, 1); assert.equal(removed.reason, '');
});

test('hiding and restoring notify branch owners like deletion but skip children hidden on their own', async () => {
    const comment = async (as, targetKind, targetId) => (await h.api('POST', '/comments', as, { targetKind, targetId, body: doc('补充说明') })).data.id;
    const notices = async as => (await h.api('GET', '/notifications', as)).data.items.filter(n => n.type === 'moderation');
    const ids = list => list.map(n => n.contentId).sort();
    const q = await h.postQuestion(), a = await h.postAnswer(q), closed = await h.postAnswer(q);
    const open = await comment('student-b', 'question', q), below = await comment('student-a', 'answer', closed);
    assert.equal((await moderate(closed, 'hide')).status, 200);
    assert.deepEqual(ids(await notices('student-b')), [closed]);
    assert.deepEqual(ids(await notices('student-a')), [below]);

    assert.equal((await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide', reason: '统一下架' })).status, 200);
    const hiddenFor = async as => (await notices(as)).filter(n => n.reason === '统一下架');
    assert.deepEqual(ids(await hiddenFor('student-a')), [q]);
    assert.deepEqual(ids(await hiddenFor('student-b')), [a, open].sort());
    assert.ok((await hiddenFor('student-b')).every(n => n.status === 'hidden'));
    assert.equal((await h.api('GET', `/me/contents/${a}`, 'student-b')).status, 200);

    for (let i = 0; i < 2; i++) assert.equal((await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'restore' })).status, 200);
    const restoredFor = async as => (await notices(as)).filter(n => n.status === 'visible');
    assert.deepEqual(ids(await restoredFor('student-a')), [q]);
    assert.deepEqual(ids(await restoredFor('student-b')), [a, open].sort());
    assert.equal((await h.api('GET', `/contents/${a}`)).status, 200);
    assert.equal((await h.api('GET', `/contents/${closed}`)).status, 404);
});