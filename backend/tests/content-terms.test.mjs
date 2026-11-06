import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, setCurrentTerm, doc, tokenFor } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });

test('publication captures the current term; edits, replies and idempotent retries preserve the original term', async () => {
    const body = { title: '跨学期问题', body: doc('问题正文'), tags: ['学期'] }, key = 'term-question';
    const created = await h.api('POST', '/courses/course-a/questions', 'student-a', body, { key });
    assert.equal(created.status, 201);
    const id = created.data.id;
    assert.equal((await h.api('GET', `/questions/${id}`)).data.termId, 'term-active');
    await setCurrentTerm(h.database, 'term-old');
    const replay = await h.api('POST', '/courses/course-a/questions', 'student-a', body, { key });
    assert.equal(replay.data.id, id);
    assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    const edited = await h.api('PATCH', `/contents/${id}`, 'student-a', { title: '已编辑问题' });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.termId, 'term-active');
    const answer = await h.postAnswer(id);
    assert.equal((await h.api('GET', `/contents/${answer}`)).data.termId, 'term-old');
    const comment = await h.api('POST', '/comments', 'student-a', { targetKind: 'question', targetId: id, body: doc('下一学期的评论') });
    assert.equal(comment.status, 201);
    assert.equal((await h.api('GET', `/contents/${comment.data.id}`)).data.termId, 'term-old');
    const later = await h.postQuestion('student-a', { tags: ['学期'] });
    for (const endpoint of ['contents?kind=question&', 'questions?']) {
        const current = await h.api('GET', `/courses/course-a/${endpoint}termId=term-active&tag=${encodeURIComponent('学期')}&pageSize=1`);
        assert.equal(current.status, 200);
        assert.equal(current.data.total, 1);
        assert.deepEqual(current.data.items.map(item => item.id), [id]);
        assert.deepEqual((await h.api('GET', `/courses/course-a/${endpoint}termId=term-old`)).data.items.map(item => item.id), [later]);
        assert.equal((await h.api('GET', `/courses/course-a/${endpoint}termId=bad%20term`)).status, 400);
        assert.equal((await h.api('GET', `/courses/course-a/${endpoint}termId=missing`)).data.total, 0);
    }
    await assert.rejects(h.database.prepare('UPDATE contents SET term_id=? WHERE id=?').bind('term-old', id).run(), /content_identity_immutable/);
    await assert.rejects(h.database.prepare('UPDATE contents SET term_id=NULL WHERE id=?').bind(id).run(), /content_identity_immutable/);
    await h.api('DELETE', `/contents/${comment.data.id}`, 'student-a');
    assert.equal((await h.api('GET', `/contents/${comment.data.id}`)).data.termId, 'term-old');
    await setCurrentTerm(h.database, null);
    const unassigned = await h.postQuestion();
    assert.equal((await h.api('GET', `/questions/${unassigned}`)).data.termId, null);
    assert.equal((await h.api('GET', '/courses/course-a/contents?kind=question')).data.total, 3);
    assert.equal((await h.api('GET', '/courses/course-a/contents?kind=question&termId=term-active')).data.total, 1);
    assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', { ...body, termId: 'term-old' })).status, 400);
});

test('course entry identifies the selected offering and exposes only the viewer’s own participation terms', async () => {
    const publicEntry = await h.api('GET', '/courses/course-a/entry');
    assert.equal(publicEntry.status, 200);
    assert.equal(publicEntry.data.term, null);
    assert.deepEqual(publicEntry.data.myTerms, []);
    const historic = await h.api('GET', '/courses/course-a/entry?termId=term-old', 'student-a');
    assert.equal(historic.data.term.id, 'term-old');
    assert.equal(historic.data.term.current, false);
    assert.deepEqual(historic.data.teachers.map(teacher => teacher.id), ['teacher-b']);
    assert.deepEqual(historic.data.myTerms.map(term => term.id), ['term-active']);
    assert.deepEqual((await h.api('GET', '/courses/course-a/entry', 'visitor')).data.myTerms.map(term => term.id), ['term-old']);
    assert.deepEqual((await h.api('GET', '/courses/course-a/entry', 'admin')).data.myTerms, []);
    assert.equal((await h.api('GET', '/courses/course-a/entry?termId=term-old', 'teacher-b')).data.permissions.canManageContent, false);
    assert.equal((await h.api('GET', '/courses/course-a/entry?termId=term-old', 'teacher-a')).data.permissions.canManageContent, true);
    assert.equal((await h.api('GET', '/courses/course-b/entry?termId=term-old')).status, 404);
    assert.equal((await h.api('GET', '/courses/course-a/entry?termId=missing')).status, 404);
    assert.equal((await h.api('GET', '/courses/course-a/entry?termId=')).status, 400);
    await setCurrentTerm(h.database, 'term-old');
    await h.database.prepare("INSERT INTO class_students VALUES('course-a','term-old','student-a','teacher-b')").run();
    assert.deepEqual((await h.api('GET', '/courses/course-a/entry', 'student-a')).data.myTerms.map(term => term.id), ['term-old', 'term-active']);
    const text = JSON.stringify(historic.data);
    for (const field of ['schoolNumber', 'department', 'studentId', 'password']) assert.equal(text.includes(field), false);
});

test('materials capture the confirmation term and later versions do not move the material to another term', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nterm fixture\n%%EOF');
    async function ticket(extra) {
        const response = await h.api('POST', '/material-uploads', 'student-a', { ...extra, file: { size: bytes.length, type: 'application/pdf' } });
        assert.equal(response.status, 201);
        const upload = response.data;
        const put = await h.worker.fetch(upload.url, { method: 'PUT', headers: { Origin: 'http://localhost',
            Cookie: `coursestack_session=${tokenFor('student-a')}`, ...upload.headers }, body: bytes });
        assert.equal(put.status, 204);
        return upload;
    }
    const first = await ticket({ mode: 'create', courseId: 'course-a', title: '跨学期资料.pdf', body: doc('资料') });
    await setCurrentTerm(h.database, 'term-old');
    const published = await h.api('POST', `/material-uploads/${first.uploadId}/confirm`, 'student-a');
    assert.equal(published.status, 200);
    const id = published.data.materialId;
    assert.equal((await h.api('GET', `/materials/${id}`)).data.termId, 'term-old');
    await setCurrentTerm(h.database, 'term-active');
    const second = await ticket({ mode: 'version', materialId: id });
    assert.equal((await h.api('POST', `/material-uploads/${second.uploadId}/confirm`, 'student-a')).status, 200);
    const detail = (await h.api('GET', `/materials/${id}`)).data;
    assert.equal(detail.termId, 'term-old');
    assert.equal(detail.latestVersion.version, 2);
    assert.equal((await h.api('POST', `/material-uploads/${first.uploadId}/confirm`, 'student-a')).data.version, 1);
    const old = await h.api('GET', '/courses/course-a/contents?kind=material&termId=term-old');
    assert.equal(old.data.total, 1);
    assert.equal(old.data.items[0].id.replaceAll('-', ''), id);
    assert.equal((await h.api('GET', '/courses/course-a/contents?kind=material&termId=term-active')).data.total, 0);
    assert.equal((await h.api('GET', '/courses/course-a/contents?kind=material')).data.total, 2);
    assert.equal((await h.api('GET', '/materials/material-a')).data.termId, null);
});