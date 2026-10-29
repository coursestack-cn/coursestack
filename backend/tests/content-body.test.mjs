import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, doc, linkDoc, internalToken } from './discussions-helpers.mjs';
import { readFile } from 'node:fs/promises';
import { bodySchema } from '../src/discussions/body.ts';
import { validateDoc, countChars, CONTENT_REQUEST_MAX_BYTES } from '../../shared/rich-text/index.ts';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const internal = path => h.api('GET', path, undefined, undefined, { internal: true, headers: { Authorization: `Bearer ${internalToken}` } });

test('backend uses the shared whitelist and every editor contract fixture', async () => {
    const root = new URL('../../frontend/src/lib/rich-text/fixtures/', import.meta.url);
    const { fixtures } = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    for (const fixture of fixtures) {
        const body = JSON.parse(await readFile(new URL(fixture.file, root), 'utf8'));
        const result = validateDoc(body);
        assert.equal(result.ok, fixture.ok, fixture.file);
        assert.equal(bodySchema.safeParse(body).success, fixture.ok, fixture.file);
        if (fixture.ok) assert.equal(countChars(body), fixture.chars, fixture.file);
        else {
            assert.equal(result.reason, fixture.reason, fixture.file);
            assert.equal(result.path, fixture.path, fixture.file);
        }
    }
});

test('all content writes accept semantic limits above the old JSON and HTTP caps', async () => {
    const body = doc('😀'.repeat(30000));
    body.content.push(...Array.from({ length: 1000 }, () => ({ type: 'paragraph' })));
    assert.ok(Buffer.byteLength(JSON.stringify(body)) > 128 * 1024);
    assert.equal(validateDoc(body).ok, true);
    const q = await h.postQuestion('student-a', { body });
    const answer = await h.postAnswer(q, 'student-b', body);
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'answer', targetId: answer, body });
    assert.equal(comment.status, 201);
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-a', { body })).status, 200);
    assert.deepEqual((await h.api('GET', `/questions/${q}`)).data.body, body);
    const oversized = await h.api('POST', '/courses/course-a/questions', 'student-a', {
        title: '请求大小边界', body: doc('正常'), padding: 'x'.repeat(CONTENT_REQUEST_MAX_BYTES)
    });
    assert.equal(oversized.status, 413);
    const course = await h.api('POST', '/courses', 'teacher-a', { name: 'x'.repeat(128 * 1024), code: 'CAP', introduction: '' });
    assert.equal(course.status, 413, 'non-content request limits remain unchanged');
});

test('unsafe links, external images and excess attributes are rejected through the API', async () => {
    const q = await h.postQuestion(), answer = await h.postAnswer(q);
    const bad = [linkDoc('链接', 'javascript:alert(1)'),
        { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/image.png', alt: null } }] },
        { ...doc('正文'), attrs: { language: 'zh' } }];
    for (const body of bad) {
        for (const [method, path, payload] of [
            ['POST', '/courses/course-a/questions', { title: '非法正文', body }],
            ['POST', `/questions/${q}/answers`, { body }],
            ['POST', '/comments', { targetKind: 'answer', targetId: answer, body }],
            ['PATCH', `/contents/${q}`, { body }]
        ]) assert.equal((await h.api(method, path, 'student-a', payload)).status, 400);
    }
});

test('question tags and moderation reasons use the same Unicode counts as their controls', async () => {
    const tag = '😀'.repeat(30), q = await h.postQuestion('student-a', { tags: [tag] });
    assert.equal((await h.api('GET', `/courses/course-a/questions?tag=${encodeURIComponent(tag)}`)).data.total, 1);
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-a', { tags: [tag + '😀'] })).status, 400);
    const reason = '😀'.repeat(1000);
    assert.equal((await h.api('POST', `/contents/${q}/reports`, 'student-b', { reason })).status, 201);
    assert.equal((await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide', reason })).status, 200);
});

test('ProseMirror nodes, marks and attributes round-trip through storage and every content reader', async () => {
    const body = { type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '富文本标题' }] },
        ...linkDoc('讲义', '/materials/material-a/versions/1').content,
        { type: 'paragraph', content: [{ type: 'text', text: '强调', marks: [{ type: 'bold' }] }] },
        { type: 'image', attrs: { src: '/api/files/example', alt: '示意图' } },
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
    const edited = await h.api('PATCH', `/contents/${q}`, 'student-a', { body: doc('更新') });
    assert.equal(edited.status, 200); assert.deepEqual(edited.data.body, doc('更新')); assert.equal(edited.data.format, 'prosemirror');
    const tagsOnly = await h.api('PATCH', `/contents/${q}`, 'student-a', { tags: ['保留正文'] });
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
    assert.equal((await h.api('DELETE', `/contents/${q}`, 'student-a', { })).status, 200);
    const after = await h.database.prepare('SELECT * FROM contents WHERE id=?').bind(q).first();
    for (const field of ['title', 'body', 'tags']) assert.equal(after[field], null, field);
    for (const field of ['id', 'kind', 'course_id', 'author_id', 'target_id', 'created_at', 'request_key', 'request_hash']) {
        assert.equal(after[field], before[field], field);
    }
    assert.equal(after.status, 'deleted'); assert.equal(after.updated_by, 'student-a');
    assert.ok(after.updated_at >= before.updated_at);
    assert.equal(await h.database.prepare('SELECT target_id FROM contents WHERE id=?').bind(answer).first('target_id'), q);
    assert.equal((await h.api('GET', `/questions/${q}/answers`)).status, 404);
    assert.equal((await h.api('GET', `/moderation/contents/${q}`, 'teacher-a')).data.body, null);
    const repeated = await h.api('POST', '/courses/course-a/questions', 'student-a', payload, options);
    assert.equal(repeated.data.id, q);
    assert.equal((await h.api('GET', `/questions/${q}`)).status, 404);
    await assert.rejects(h.database.prepare('UPDATE contents SET body=? WHERE id=?').bind(JSON.stringify(doc('不能恢复')), q).run(), /contents_deleted_payload/);
});