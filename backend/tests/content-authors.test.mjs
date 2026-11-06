import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, setCurrentTerm, doc } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });

async function get(path, as) {
    const response = await h.api('GET', path, as);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
}
const contents = query => get(`/courses/course-a/contents?${query}`);
const authors = (query = '', as) => get(`/courses/course-a/content-authors?${query}`, as);

test('publisher filtering uses root authors and combines with filters before totals and pagination', async () => {
    const own = await h.postQuestion('student-a', { title: '积分练习', tags: ['练习'] });
    await h.postQuestion('student-a', { title: '积分题解', tags: ['练习'] });
    const other = await h.postQuestion('student-b', { title: '积分练习', tags: ['练习'] });
    await h.postAnswer(other, 'student-a');
    await h.api('POST', '/comments', 'student-a', { targetKind: 'question', targetId: other, body: doc('参与讨论') });
    const answer = await h.postAnswer(own, 'student-b');
    await h.accept(own, answer);
    await setCurrentTerm(h.database, 'term-old');
    const historical = await h.postQuestion('student-a', { title: '积分练习', tags: ['练习'] });
    await setCurrentTerm(h.database, 'term-active');
    const filtered = await contents('authorId=student-a&pageSize=1&page=2&sort=newest');
    assert.equal(filtered.total, 4);
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0].author.id, 'student-a');
    const combined = await contents(`authorId=student-a&kind=question&termId=term-active&title=${encodeURIComponent('积分')}&tag=${encodeURIComponent('练习')}&state=solved&sort=score`);
    assert.equal(combined.total, 1);
    assert.equal(combined.items[0].id, own);
    assert.deepEqual((await contents('authorId=student-a&kind=question&termId=term-old')).items.map(item => item.id), [historical]);
    assert.deepEqual((await contents('authorId=student-a&kind=material')).items.map(item => item.id), ['material-a']);
    assert.equal((await contents('authorId=student-b')).total, 1);
    assert.equal((await contents('authorId=missing')).total, 0);
    assert.equal((await contents('authorId=teacher-b')).total, 0);
    assert.equal((await contents('')).total, 5);
    for (const authorId of ['', '%2F', 'a'.repeat(101)]) {
        for (const endpoint of ['contents', 'content-authors']) {
            const response = await h.api('GET', `/courses/course-a/${endpoint}?authorId=${authorId}`);
            assert.equal(response.status, 400);
            assert.equal(response.data.error.code, 'INVALID_FILTER');
        }
    }
});

test('candidates only include public root publishers in this course and stay independent of content filters', async () => {
    const student = await h.postQuestion('student-b');
    const teacher = await h.postQuestion('teacher-a');
    await h.postAnswer(student, 'visitor');
    await h.api('POST', '/comments', 'teacher-b', { targetKind: 'question', targetId: student, body: doc('仅评论') });
    const candidates = await authors();
    assert.deepEqual(candidates.items.map(item => item.id).sort(), ['student-a', 'student-b', 'teacher-a']);
    const teacherRow = candidates.items.find(item => item.id === 'teacher-a');
    assert.equal(teacherRow.isTeacher, true);
    assert.equal(teacherRow.isCourseTeacher, true);
    assert.deepEqual((await authors('kind=material&termId=missing&title=missing')).items, candidates.items);
    assert.equal((await authors('authorId=teacher-b')).total, 0);
    assert.equal((await authors('authorId=visitor')).total, 0);
    assert.deepEqual(Object.keys(teacherRow).sort(), ['id', 'nickname', 'avatarUrl', 'isDeleted', 'isTeacher', 'isCourseTeacher', 'shortId'].sort());
    const hidden = await h.api('PUT', `/contents/${teacher}/moderation`, 'teacher-a', { action: 'hide', reason: '' });
    assert.equal(hidden.status, 200);
    for (const viewer of [undefined, 'teacher-a', 'admin']) assert.equal((await authors('authorId=teacher-a', viewer)).total, 0);
    assert.equal((await contents('authorId=teacher-a')).total, 0);
    assert.equal((await h.api('DELETE', `/contents/${student}`, 'student-b')).status, 409);
    // An answer prevents owner deletion; management deletion must remove the whole public branch.
    assert.equal((await h.api('PUT', `/contents/${student}/moderation`, 'teacher-a', { action: 'delete', reason: '' })).status, 200);
    assert.deepEqual((await authors()).items.map(item => item.id), ['student-a']);
    assert.equal((await h.api('GET', '/courses/missing/content-authors')).status, 404);
});

test('nickname search is literal, duplicate labels work across pages, and selection survives renames', async () => {
    await h.postQuestion('student-b');
    await h.database.prepare("UPDATE accounts SET nickname='同名_100%ABC' WHERE id IN ('student-a','student-b')").run();
    const first = await authors('q=%20abc%20&pageSize=1');
    const second = await authors('q=ABC&pageSize=1&page=2');
    assert.equal(first.total, 2);
    assert.notEqual(first.items[0].id, second.items[0].id);
    assert.notEqual(first.items[0].shortId, second.items[0].shortId);
    assert.ok(first.items[0].shortId);
    assert.equal((await authors('q=%25')).total, 2);
    assert.equal((await authors('q=_')).total, 2);
    await h.database.prepare("UPDATE accounts SET nickname='新昵称' WHERE id='student-b'").run();
    const selected = await authors('authorId=student-b');
    assert.equal(selected.items[0].nickname, '新昵称');
    assert.equal((await contents('authorId=student-b')).total, 1);
    assert.equal((await authors('q=ABC')).total, 1);
    assert.equal((await authors(`q=${encodeURIComponent('无匹配')}`)).total, 0);
    assert.equal((await h.api('GET', `/courses/course-a/content-authors?q=${'a'.repeat(81)}`)).status, 400);
    assert.equal((await h.api('GET', '/courses/course-a/content-authors?pageSize=51')).status, 400);
});

test('deleted, disabled and unnamed publishers keep public-content semantics without exposing private identity', async () => {
    await h.postQuestion('student-b');
    await h.postQuestion('teacher-a');
    await h.database.prepare("UPDATE accounts SET nickname=NULL WHERE id='student-a'").run();
    await h.database.prepare("UPDATE accounts SET status='disabled',avatar_key='private-avatar' WHERE id='teacher-a'").run();
    const removed = await h.api('DELETE', '/admin/accounts/student-b', 'admin');
    assert.equal(removed.status, 200);
    const deleted = (await authors('authorId=student-b')).items[0];
    assert.equal(deleted.isDeleted, true);
    assert.equal(deleted.nickname, '已删除');
    assert.equal(deleted.avatarUrl, null);
    assert.ok(deleted.shortId);
    assert.equal((await authors(`q=${encodeURIComponent('学习者乙')}`)).total, 0);
    const unnamed = (await authors('authorId=student-a')).items[0];
    assert.equal(unnamed.nickname, null);
    assert.ok(unnamed.shortId);
    assert.equal((await authors(`q=${encodeURIComponent('未设置昵称')}`)).total, 1);
    const disabled = (await authors('authorId=teacher-a')).items[0];
    assert.equal(disabled.avatarUrl, null);
    assert.equal(disabled.isCourseTeacher, false);
    assert.equal((await contents('authorId=student-b')).total, 1);
    const serialized = JSON.stringify(await authors());
    for (const privateField of ['schoolNumber', 'school_number', 'password', 'department', 'avatar_key', '虚构']) assert.equal(serialized.includes(privateField), false);
});