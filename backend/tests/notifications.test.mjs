import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { doc, start } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const list = async (as = 'student-a', query = '') => {
    const r = await h.api('GET', `/notifications${query}`, as);
    assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
};
const comment = async (targetKind, targetId, as = 'student-b', opts) => {
    const r = await h.api('POST', '/comments', as, { targetKind, targetId, body: doc('通知测试') }, opts);
    assert.equal(r.status, 201); return r.data.id;
};

test('direct answers and replies notify recipients once, without self-notices or replay duplicates', async () => {
    const q = await h.postQuestion();
    await h.postAnswer(q);
    assert.deepEqual((await list()).items.map(n => n.type), ['answer']);
    assert.equal((await list('student-b')).unreadCount, 0);
    const parent = await comment('question', q, 'student-a');
    const reply = await comment('comment', parent, 'student-b', { key: 'reply-replay' });
    await comment('comment', parent, 'student-b', { key: 'reply-replay' });
    const rows = (await list()).items.filter(n => n.contentId === reply);
    assert.equal(rows.length, 1); assert.equal(rows[0].type, 'reply');
    assert.equal(rows[0].href, `/comments/${reply}`);
    const other = await comment('question', q, 'visitor');
    await comment('comment', other, 'student-b');
    assert.equal((await list('visitor')).items[0].type, 'reply');
    assert.equal((await list()).items[0].type, 'comment');
});

test('acceptance history survives cancellation and reacceptance even with zero points', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    await h.accept(q, a); await h.accept(q, a);
    await h.accept(q, null); await h.accept(q, null);
    await h.accept(q, a);
    assert.deepEqual((await list('student-b')).items.map(n => n.type), ['accepted', 'unaccepted', 'accepted']);
    assert.equal((await h.database.prepare('SELECT COUNT(*) AS n FROM bonus_ledger').first()).n, 0);
});

test('external bonus changes are durable while own rewards stay outside the inbox', async () => {
    await h.policy({ pointsQuestion: 1, pointsAnswer: 1, pointsAcceptance: 2 });
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    assert.equal((await list('student-b')).items.length, 0);
    await h.accept(q, a);
    const items = (await list('student-b')).items;
    assert.equal(items.filter(n => n.type === 'accepted').length, 1);
    assert.equal(items.find(n => n.type === 'bonus').deltaPoints, 2);
    const r = await h.api('POST', '/courses/course-a/terms/term-active/teachers/teacher-a/bonus-adjustments', 'teacher-a',
        { studentId: 'student-a', deltaPoints: 5, reason: '课堂参与' }, { key: 'manual-notice' });
    assert.equal(r.status, 201);
    await h.api('POST', '/courses/course-a/terms/term-active/teachers/teacher-a/bonus-adjustments', 'teacher-a',
        { studentId: 'student-a', deltaPoints: 5, reason: '课堂参与' }, { key: 'manual-notice' });
    const bonus = (await list()).items.filter(n => n.type === 'bonus');
    assert.equal(bonus.length, 1); assert.equal(bonus[0].reason, '课堂参与');
    assert.match(bonus[0].href, /bonus=history&bonusTerm=term-active/);
});

test('cursor batches and read-through boundaries exclude concurrent notices and preserve read history', async () => {
    const q = await h.postQuestion();
    await h.database.batch(Array.from({ length: 30 }, (_, i) => h.database.prepare(
        "INSERT INTO notifications(account_id,actor_id,kind,source_id,content_id,created_at) VALUES('student-a','teacher-a','accepted',?,?,100)"
    ).bind(`seed-${i}`, q)));
    const first = await list();
    assert.equal(first.items.length, 20); assert.equal(first.unreadCount, 30); assert.equal(first.hasMore, true);
    const second = await list('student-a', `?beforeId=${first.nextCursor}`);
    assert.equal(second.items.length, 10); assert.equal(second.nextCursor, null);
    await h.database.prepare("INSERT INTO notifications(account_id,actor_id,kind,source_id,content_id,created_at) VALUES('student-a','teacher-a','accepted','concurrent',?,100)").bind(q).run();
    const read = await h.api('PUT', '/notifications/read', 'student-a', { throughId: first.readThroughId });
    assert.equal(read.data.changed, 30); assert.equal(read.data.unreadCount, 1);
    assert.equal((await h.api('PUT', '/notifications/read', 'student-a', { throughId: first.readThroughId })).data.changed, 0);
    assert.equal((await list()).items.length, 1);
    assert.equal((await list('student-a', '?status=read')).items.length, 20);
    const count = await h.api('GET', '/notifications/count', 'student-a');
    assert.deepEqual(count.data, { viewer: 'student-a', unreadCount: 1 });
    const state = await h.api('GET', `/notifications/state?ids=${first.items[0].id},${second.items[5].id}`, 'student-a');
    assert.ok(state.data.items.every(n => n.readAt));
    const oldTime = state.data.items[0].readAt;
    const single = await h.api('PUT', `/notifications/${first.items[0].id}/read`, 'student-a', {});
    assert.equal(single.data.readAt, oldTime);
    assert.equal((await h.api('PUT', `/notifications/${first.items[0].id}/read`, 'student-b', {})).status, 404);
    assert.equal((await h.api('GET', `/notifications/state?ids=${first.items[0].id}`, 'student-b')).data.items.length, 0);
});

test('hidden and deleted targets retain unread notices without exposing their titles or public links', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    const before = (await list()).items[0];
    await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { action: 'hide', reason: '管理原因' });
    const hidden = (await list()).items.find(n => n.id === before.id);
    assert.equal(hidden.available, false); assert.equal(hidden.title, null); assert.equal(hidden.href, null);
    assert.equal(hidden.reason, ''); assert.equal(hidden.readAt, null);
    await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { action: 'delete' });
    assert.equal((await list()).items.find(n => n.id === before.id).available, false);
    assert.equal((await h.api('PUT', `/notifications/${before.id}/read`, 'student-a', {})).status, 200);
});

test('restoring a child under a hidden parent reports its current limited visibility', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { action: 'hide' });
    await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide' });
    await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { action: 'restore' });
    const notice = (await list('student-b')).items[0];
    assert.equal(notice.status, 'visible'); assert.equal(notice.isPublic, false); assert.equal(notice.available, true);
    assert.equal(notice.href, `/me/contents/${a}`);
});

test('notification reads require authentication and reject invalid cursors and oversized batches', async () => {
    assert.equal((await h.api('GET', '/notifications')).status, 401);
    for (const q of ['?beforeId=0', '?status=bad', '?pageSize=21', '?beforeId=9007199254740992']) {
        assert.equal((await h.api('GET', `/notifications${q}`, 'student-a')).status, 400);
    }
    assert.equal((await h.api('GET', `/notifications/state?ids=${Array.from({ length: 21 }, (_, i) => i + 1)}`, 'student-a')).status, 400);
    assert.equal((await h.api('PUT', '/notifications/read', 'student-a', { throughId: -1 })).status, 400);
});