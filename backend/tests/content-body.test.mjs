import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, doc, linkDoc, internalToken } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const internal = path => h.api('GET', path, undefined, undefined, { internal: true, headers: { Authorization: `Bearer ${internalToken}` } });

test('ProseMirror nodes, marks and attributes round-trip through storage and every content reader', async () => {
    const body = { type: 'doc', attrs: { language: 'zh' }, content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '富文本标题' }] },
        ...linkDoc('讲义', '/materials/material-a/versions/1').content,
        { type: 'paragraph', content: [{ type: 'text', text: '强调', marks: [{ type: 'bold' }] }] },
        { type: 'image', attrs: { src: '/api/files/example', alt: '示意图', metadata: { width: 100 } } },
    ] };
    const q = await h.postQuestion('student-a', { body });
    const stored = await h.database.prepare('SELECT body,json_valid(body) AS valid FROM contents WHERE id=?').bind(q).first();
    assert.equal(stored.valid, 1); assert.deepEqual(JSON.parse(stored.body), body);
    for (const response of [await h.api('GET', `/questions/${q}`), await h.api('GET', `/contents/${q}`),
        await h.api('GET', `/moderation/contents/${q}`, 'teacher-a'), await internal(`/internal/contents/${q}`)]) {
        assert.equal(response.status, 200); assert.deepEqual(response.data.body, body);
    }
    for (const path of ['/courses/course-a/questions', '/me/activity']) {
        const page = await h.api('GET', path, 'student-a');
        assert.deepEqual(page.data.items.find(item => item.id === q).body, body);
    }
    const snapshot = await internal('/internal/documents');
    assert.deepEqual(snapshot.data.items.find(item => item.id === q).body, body);
    assert.equal(snapshot.data.items.find(item => item.id === q).format, 'prosemirror');
    assert.equal(snapshot.data.items.find(item => item.id === 'course-a').format, 'text');
    const answer = await h.postAnswer(q, 'student-b', body);
    assert.deepEqual((await h.api('GET', `/questions/${q}/answers`)).data.items.find(item => item.id === answer).body, body);
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'question', targetId: q, body });
    assert.equal(comment.status, 201);
    assert.deepEqual((await h.api('GET', `/comments?targetKind=question&targetId=${q}`)).data.items[0].body, body);
    const edited = await h.api('PATCH', `/contents/${q}`, 'student-a', { revision: 1, body: doc('更新') });
    assert.equal(edited.status, 200); assert.deepEqual(edited.data.body, doc('更新')); assert.equal(edited.data.format, 'prosemirror');
    const tagsOnly = await h.api('PATCH', `/contents/${q}`, 'student-a', { revision: 2, tags: ['保留正文'] });
    assert.deepEqual(tagsOnly.data.body, doc('更新'));
});

test('content writes reject plain or serialized strings and malformed ProseMirror structures', async () => {
    let nested = { type: 'paragraph' };
    for (let i = 0; i < 66; i++) nested = { type: 'blockquote', content: [nested] };
    const invalid = [undefined, null, '', 'Markdown 正文', JSON.stringify(doc('不接受双重编码')), [], 123,
        {}, { type: 'paragraph' }, { type: 'doc', content: {} }, { type: 'doc', content: [null] },
        { type: 'doc', content: [{}] }, { type: 'doc', content: [{ type: 'text', text: '' }] },
        { type: 'doc', content: [{ type: 'paragraph', text: '错误位置' }] },
        { type: 'doc', content: [{ type: 'paragraph', marks: [null] }] },
        { type: 'doc', content: [nested] }, doc('x'.repeat(30001))];
    for (const body of invalid) {
        const response = await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '校验', body });
        assert.equal(response.status, 400, JSON.stringify(response.data));
    }
    assert.equal(await h.database.prepare("SELECT count(*) AS n FROM contents WHERE kind='question'").first('n'), 0);
});

test('database permits NULL body but rejects malformed JSON on insertion and update', async () => {
    const q = await h.postQuestion();
    for (const invalid of ['', '正文', '{broken']) {
        await assert.rejects(h.database.prepare('UPDATE contents SET body=? WHERE id=?').bind(invalid, q).run(), /contents_body_json/);
        await assert.rejects(h.database.prepare(`INSERT INTO contents(id,kind,course_id,author_id,title,body,updated_by,request_key,request_hash)
            VALUES ('invalid-body','question','course-a','student-a','非法',?,'student-a','invalid-body','fixture')`).bind(invalid).run(), /contents_body_json/);
    }
    await h.database.prepare('UPDATE contents SET body=NULL WHERE id=?').bind(q).run();
    assert.equal((await h.api('GET', `/contents/${q}`)).data.body, null);
});

test('deletion clears only title, body and tags while preserving relationships, metadata and idempotency', async () => {
    const payload = { title: '待删除', body: doc('清除正文'), tags: ['清除标签'] }, options = { key: 'delete-body-request' };
    const made = await h.api('POST', '/courses/course-a/questions', 'student-a', payload, options), q = made.data.id;
    const answer = await h.postAnswer(q);
    const before = await h.database.prepare('SELECT * FROM contents WHERE id=?').bind(q).first();
    await assert.rejects(h.database.prepare("UPDATE contents SET status='deleted' WHERE id=?").bind(q).run(), /contents_deleted_payload/);
    assert.equal((await h.api('DELETE', `/contents/${q}`, 'student-a', { revision: 1 })).status, 200);
    const after = await h.database.prepare('SELECT * FROM contents WHERE id=?').bind(q).first();
    for (const field of ['title', 'body', 'tags']) assert.equal(after[field], null, field);
    for (const field of ['id', 'kind', 'course_id', 'author_id', 'target_kind', 'target_id', 'created_at', 'request_key', 'request_hash']) {
        assert.equal(after[field], before[field], field);
    }
    assert.equal(after.status, 'deleted'); assert.equal(after.revision, 2); assert.equal(after.updated_by, 'student-a');
    assert.ok(after.updated_at >= before.updated_at);
    assert.equal((await h.api('GET', `/questions/${q}/answers`)).data.items[0].id, answer);
    assert.equal((await h.api('GET', `/moderation/contents/${q}`, 'teacher-a')).data.body, null);
    const repeated = await h.api('POST', '/courses/course-a/questions', 'student-a', payload, options);
    assert.equal(repeated.data.id, q);
    assert.equal((await h.api('GET', `/questions/${q}`)).data.status, 'deleted');
    await assert.rejects(h.database.prepare('UPDATE contents SET body=? WHERE id=?').bind(JSON.stringify(doc('不能恢复')), q).run(), /contents_deleted_payload/);
});