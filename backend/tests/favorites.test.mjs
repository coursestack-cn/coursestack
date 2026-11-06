import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { doc, setCurrentTerm, start } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const favorite = (type, id, as = 'visitor', method = 'PUT') => h.api(method, `/me/favorites/${type}/${encodeURIComponent(id)}`, as, method === 'PUT' ? {} : undefined);
const list = async (as = 'visitor', query = '') => {
    const r = await h.api('GET', `/me/favorites${query}`, as); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
};
const notices = async (as = 'visitor') => (await h.api('GET', '/notifications?status=all', as)).data.items;
const feed = async (as = 'visitor') => (await h.api('GET', '/me/feed', as)).data;
const count = async table => (await h.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;

// Real transactions and content visibility, rather than mocks of the implementation.
test('favorites are private, idempotent, stable and restricted to valid top-level objects', async () => {
    const q = await h.postQuestion(), answer = await h.postAnswer(q);
    assert.equal((await favorite('course', 'course-a')).status, 200);
    const first = await favorite('question', q);
    assert.equal((await favorite('question', q)).data.createdAt, first.data.createdAt);
    assert.equal((await list()).total, 2);
    assert.equal((await list('student-a')).total, 0);
    assert.equal((await favorite('question', answer)).status, 404);
    assert.equal((await favorite('answer', answer)).status, 400);
    assert.equal((await favorite('material', 'absent')).status, 404);
    assert.equal((await h.api('PUT', '/me/favorites/course/course-a', undefined, {})).status, 401);
    const targets = [{ type: 'course', id: 'course-a' }, { type: 'question', id: q }, { type: 'material', id: 'material-b' }, { type: 'material', id: q }];
    const state = await h.api('GET', `/me/favorites/status?${new URLSearchParams({ targets: JSON.stringify(targets) })}`, 'visitor');
    assert.deepEqual(state.data.items.map(t => t.favorited), [true, true, false, false]);
    await favorite('course', 'course-a', 'visitor', 'DELETE');
    await favorite('course', 'course-a', 'visitor', 'DELETE');
    assert.equal((await list()).total, 1);
    await favorite('course', 'course-a');
    assert.equal((await list()).items[0].type, 'course');
    assert.equal((await h.api('GET', '/me/courses', 'visitor')).data.total, 0);
});

test('filter counts and pagination include unavailable placeholders without leaking hidden content', async () => {
    const q = await h.postQuestion();
    await favorite('course', 'course-b'); await favorite('material', 'material-a'); await favorite('question', q);
    const filtered = await list('visitor', '?courseId=course-a&type=question&pageSize=1');
    assert.equal(filtered.total, 1); assert.deepEqual(filtered.counts, { all: 2, course: 0, material: 1, question: 1 });
    assert.equal(filtered.courses.length, 2);
    await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide' });
    const hidden = (await list()).items.find(item => item.targetId === q);
    assert.equal(hidden.available, false); assert.equal(hidden.title, null); assert.equal(hidden.description, null);
    assert.equal((await favorite('question', q, 'student-b')).status, 404);
    await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'restore' });
    assert.equal((await list()).items.find(item => item.targetId === q).available, true);
    await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'delete' });
    assert.equal((await list()).items.find(item => item.targetId === q).available, false);
    assert.equal((await favorite('question', q, 'visitor', 'DELETE')).status, 200);
});

test('feed unions current relationships and favorite courses, deduplicates and follows term changes', async () => {
    const q = await h.postQuestion();
    assert.equal((await feed()).total, 0);
    await favorite('course', 'course-a');
    assert.ok((await feed()).items.some(item => item.contentId === q));
    const before = (await feed('student-a')).items;
    await favorite('course', 'course-a', 'student-a');
    assert.deepEqual((await feed('student-a')).items, before);
    await favorite('course', 'course-a', 'student-a', 'DELETE');
    assert.deepEqual((await feed('student-a')).items, before);
    await setCurrentTerm(h.database, 'term-old');
    assert.equal((await feed('student-a')).total, 0);
    await favorite('course', 'course-a', 'student-a');
    assert.ok((await feed('student-a')).total > 0);
    await h.database.prepare("UPDATE contents SET status='hidden',updated_by='admin' WHERE id=?").bind(q).run();
    assert.equal((await feed('student-a')).items.some(item => item.contentId === q), false);
});

test('one interaction reaches direct and subscribed recipients once; cancellation affects future events only', async () => {
    const q = await h.postQuestion();
    await favorite('question', q); await favorite('question', q, 'student-a');
    const a = await h.postAnswer(q);
    assert.equal((await notices()).filter(n => n.contentId === a).length, 1);
    const owner = (await notices('student-a')).filter(n => n.contentId === a);
    assert.equal(owner.length, 1); assert.equal(owner[0].type, 'answer');
    assert.equal((await notices())[0].eventType, 'answer_created');
    await favorite('question', q, 'visitor', 'DELETE');
    await h.postAnswer(q, 'teacher-a');
    assert.equal((await notices()).length, 1);
    await favorite('question', q);
    assert.equal((await notices()).length, 1);
    await h.api('POST', '/comments', 'student-b', { targetKind: 'answer', targetId: a, body: doc('回答评论') }, { key: 'favorite-replay' });
    await h.api('POST', '/comments', 'student-b', { targetKind: 'answer', targetId: a, body: doc('回答评论') }, { key: 'favorite-replay' });
    assert.equal((await notices()).length, 1);
    const comment = await h.api('POST', '/comments', 'visitor', { targetKind: 'question', targetId: q, body: doc('自己评论') });
    assert.equal(comment.status, 201);
    assert.equal((await notices('student-a')).filter(n => n.contentId === comment.data.id && n.type === 'comment').length, 1);
    assert.equal((await notices()).length, 1);
});

test('edits do not notify subscribers; acceptance changes remain distinct and recheck visibility', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    await favorite('question', q);
    const body = { body: doc('修改后的回答') };
    await h.api('PATCH', `/contents/${a}`, 'student-b', body);
    await h.api('PATCH', `/contents/${a}`, 'student-b', body);
    assert.equal((await notices()).length, 0);
    await h.accept(q, a); await h.accept(q, a); await h.accept(q, null); await h.accept(q, a);
    assert.equal((await notices()).filter(n => n.eventType === 'acceptance_changed').length, 3);
    assert.equal((await notices()).some(n => n.eventType === 'content_edited'), false);
    const acceptance = (await notices()).find(n => n.eventType === 'acceptance_changed');
    await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide' });
    const hidden = (await notices()).find(n => n.id === acceptance.id);
    assert.equal(hidden.available, false); assert.equal(hidden.title, null); assert.equal(hidden.href, null);
    const before = await count('content_events');
    await h.api('PATCH', `/contents/${a}`, 'student-b', { body: doc('私下编辑') });
    assert.equal(await count('content_events'), before);
});

test('material subscriptions track whole materials and real versions, never material comments or metadata in the feed', async () => {
    await favorite('material', 'material-a'); await favorite('course', 'course-a');
    await h.database.prepare("INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by) VALUES('material-a',3,'test/3',8,'application/pdf','student-a','student-a')").run();
    assert.equal((await notices())[0].eventType, 'material_version'); assert.equal((await notices())[0].version, 3);
    assert.ok((await feed()).items.some(item => item.version === 3));
    const before = (await feed()).total;
    await h.api('PATCH', '/contents/material-a', 'student-a', { title: '更新后的讲义' });
    assert.equal((await notices()).length, 1);
    assert.equal((await notices())[0].eventType, 'material_version'); assert.equal((await feed()).total, before);
    await h.api('POST', '/comments', 'student-b', { targetKind: 'material', targetId: 'material-a', body: doc('资料评论') });
    assert.equal((await notices()).length, 1);
    await h.database.prepare("DELETE FROM file_versions WHERE material_id='material-a' AND version=3").run();
    assert.equal((await feed()).items.some(item => item.version === 3), false);
});

test('concurrent favorites remain unique and reject oversized status queries and cross-account writes', async () => {
    await Promise.all(Array.from({ length: 8 }, () => favorite('material', 'material-a')));
    assert.equal((await list()).total, 1);
    const tooMany = Array.from({ length: 51 }, () => ({ type: 'course', id: 'course-a' }));
    assert.equal((await h.api('GET', `/me/favorites/status?${new URLSearchParams({ targets: JSON.stringify(tooMany) })}`, 'visitor')).status, 400);
    assert.equal((await h.api('GET', '/me/favorites?type=answer', 'visitor')).status, 400);
    assert.equal((await h.api('PUT', '/me/favorites/course/course-a', 'visitor', {}, { headers: { 'X-Expected-Account': 'student-a' } })).status, 409);
});