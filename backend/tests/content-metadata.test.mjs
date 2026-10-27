import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openapi } from '../src/openapi.ts';
import { start, doc, internalToken } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });

async function detail(id) {
    const response = await h.api('GET', `/contents/${id}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
}
async function comment(targetId, as = 'student-b') {
    const targetKind = (await detail(targetId)).kind;
    const response = await h.api('POST', '/comments', as, { targetKind, targetId, body: doc('回复正文') });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id;
}
async function edit(id, as, fields) {
    const response = await h.api('PATCH', `/contents/${id}`, as, { ...fields });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
}
async function hide(id) {
    const response = await h.api('PUT', `/contents/${id}/moderation`, 'teacher-a',
        { action: 'hide', reason: '测试下架内容' });
    assert.equal(response.status, 200, JSON.stringify(response.data));
}
async function restore(id) {
    const response = await h.api('PUT', `/contents/${id}/moderation`, 'teacher-a', { action: 'restore', reason: '测试恢复内容' });
    assert.equal(response.status, 200, JSON.stringify(response.data));
}
async function remove(id) {
    const response = await h.api('DELETE', `/contents/${id}`, 'admin', { });
    assert.equal(response.status, 200, JSON.stringify(response.data));
}

test('all public content readers expose unedited timestamps, reply summaries and counts', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q), c = await comment(a, 'student-a');
    const rows = await Promise.all([q, a, c, 'material-a'].map(detail));
    for (const row of rows) {
        assert.equal(row.editedAt, null);
        assert.equal(Number.isInteger(row.commentCount), true);
        assert.equal(Object.hasOwn(row, 'answerCount'), row.kind === 'question');
    }
    assert.equal(rows[0].answerCount, 1); assert.equal(rows[0].commentCount, 0); assert.equal(rows[0].replyTo, null);
    assert.equal(rows[1].commentCount, 1);
    assert.deepEqual(rows[1].replyTo, { id: q, author: { nickname: '学习者甲', isDeleted: false }, isDeleted: false });
    assert.deepEqual(rows[2].replyTo, { id: a, author: { nickname: '学习者乙', isDeleted: false }, isDeleted: false });
    assert.equal(rows[3].replyTo, null); assert.equal(rows[3].commentCount, 0);
    const question = await h.api('GET', `/questions/${q}`);
    assert.deepEqual(question.data, rows[0]);
    for (const [path, as, id] of [
        ['/courses/course-a/questions', undefined, q], [`/questions/${q}/answers`, undefined, a],
        [`/comments?targetKind=answer&targetId=${a}`, undefined, c],
        ['/me/activity', 'student-a', q], ['/me/activity', 'student-a', 'material-a'],
        ['/me/activity', 'student-a', c], ['/me/activity', 'student-b', a],
    ]) {
        const response = await h.api('GET', path, as);
        assert.equal(response.status, 200);
        const row = response.data.items.find(item => item.id === id), expected = rows.find(item => item.id === id);
        for (const key of ['editedAt', 'replyTo', 'answerCount', 'commentCount']) assert.deepEqual(row[key], expected[key], `${path}: ${key}`);
    }
    const internal = await h.api('GET', `/internal/contents/${c}`, undefined, undefined,
        { internal: true, headers: { Authorization: `Bearer ${internalToken}` } });
    assert.equal(internal.data.editedAt, null); assert.deepEqual(internal.data.replyTo, rows[2].replyTo);
    const column = (await h.database.prepare('PRAGMA table_info(contents)').all()).results.find(row => row.name === 'edited_at');
    assert.equal(column.type, 'INTEGER'); assert.equal(column.notnull, 0); assert.equal(column.dflt_value, null);
});

test('authors and managers set Unix-second editedAt only for real title, body or tag changes on every content kind', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q), c = await comment(a);
    for (const [id, author] of [[q, 'student-a'], ['material-a', 'student-a'], [a, 'student-b'], [c, 'student-b']]) {
        const titled = ['question', 'material'].includes((await detail(id)).kind);
        const changes = titled ? [{ title: '修改标题' }, { body: doc('修改正文') }, { tags: ['修改标签'] }]
            : ['作者修改', '教师修改', '管理员修改'].map(text => ({ body: doc(text) }));
        for (const [index, as] of [author, 'teacher-a', 'admin'].entries()) {
            await h.database.prepare('UPDATE contents SET edited_at=1 WHERE id=?').bind(id).run();
            const before = Math.floor(Date.now() / 1000), row = await edit(id, as, changes[index]);
            assert.equal(Number.isInteger(row.editedAt), true);
            assert.ok(row.editedAt >= before && row.editedAt <= Math.floor(Date.now() / 1000));
            assert.equal(await h.database.prepare('SELECT edited_at FROM contents WHERE id=?').bind(id).first('edited_at'), row.editedAt);
        }
    }
    const question = (await h.api('GET', '/courses/course-a/questions')).data.items.find(row => row.id === q);
    assert.equal(question.editedAt, (await detail(q)).editedAt);
    const answers = (await h.api('GET', `/questions/${q}/answers`)).data.items;
    assert.equal(answers.find(row => row.id === a).editedAt, (await detail(a)).editedAt);
    const comments = (await h.api('GET', `/comments?targetKind=answer&targetId=${a}`)).data.items;
    assert.equal(comments.find(row => row.id === c).editedAt, (await detail(c)).editedAt);
    const materials = (await h.api('GET', '/me/activity?kind=material', 'student-a')).data.items;
    assert.equal(materials.find(row => row.id === 'material-a').editedAt, (await detail('material-a')).editedAt);
});

test('equal normalized values and reordered JSON object keys preserve both null and existing editedAt', async () => {
    const body = { type: 'doc', attrs: { first: 1, second: { a: true, b: null } }, content: doc('正文').content };
    const reordered = { content: [{ content: [{ text: '正文', type: 'text' }], type: 'paragraph' }],
        attrs: { second: { b: null, a: true }, first: 1 }, type: 'doc' };
    const q = await h.postQuestion('student-a', { title: '标题', body, tags: ['标签'] });
    const storedBody = JSON.stringify(body, null, 2);
    await h.database.prepare('UPDATE contents SET body=? WHERE id=?').bind(storedBody, q).run();
    const unchanged = await edit(q, 'student-a', { title: ' 标题 ', body: reordered, tags: [' 标签 ', '标签'] });
    assert.equal(unchanged.editedAt, null);
    assert.equal(await h.database.prepare('SELECT body FROM contents WHERE id=?').bind(q).first('body'), storedBody);
    await h.database.prepare('UPDATE contents SET edited_at=1 WHERE id=?').bind(q).run();
    assert.equal((await edit(q, 'teacher-a', { body: reordered })).editedAt, 1);
    assert.equal((await edit(q, 'student-a', {})).editedAt, 1);
    assert.equal((await edit(q, 'admin', { tags: ['标签'] })).editedAt, 1);
    const emptyTags = await h.postQuestion();
    assert.equal((await edit(emptyTags, 'student-a', { tags: [] })).editedAt, null);
    assert.equal((await edit(emptyTags, 'student-a', { tags: null })).editedAt, null);
    const changed = await edit(q, 'student-a', { body: { ...body, attrs: { ...body.attrs, first: 2 } } });
    assert.ok(changed.editedAt > 1);
    await h.database.prepare('UPDATE contents SET edited_at=1 WHERE id=?').bind(q).run();
    assert.ok((await edit(q, 'student-a', { tags: null })).editedAt > 1);
    const a = await h.postAnswer(q), c = await comment(q);
    for (const id of [a, c]) assert.equal((await edit(id, 'student-b', { body: (await detail(id)).body })).editedAt, null);
});

test('invalid and unauthorized edits preserve metadata; an old page can submit the final content', async () => {
    const q = await h.postQuestion(), before = await detail(q);
    for (const as of ['student-b', 'teacher-b']) {
        assert.equal((await h.api('PATCH', '/contents/' + q, as, { body: before.body })).status, 403);
    }
    for (const fields of [{ editedAt: 1 }, { editedAt: null }, { body: null }]) {
        assert.equal((await h.api('PATCH', '/contents/' + q, 'student-a', fields)).status, 400);
    }
    assert.deepEqual(await detail(q), before);
    await edit(q, 'student-a', { body: doc('新正文') });
    await h.database.prepare('UPDATE contents SET edited_at=1 WHERE id=?').bind(q).run();
    const last = await edit(q, 'student-a', { body: before.body });
    assert.deepEqual(last.body, before.body); assert.ok(last.editedAt > 1);
    assert.equal((await edit(q, 'student-a', { body: before.body })).editedAt, last.editedAt);
});

test('votes, acceptance, points, visibility, versions and deletion preserve editedAt', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q), c = await comment(q);
    const expected = new Map([[q, null], [a, 7], [c, null], ['material-a', 11]]);
    for (const [id, value] of expected) await h.database.prepare('UPDATE contents SET edited_at=? WHERE id=?').bind(value, id).run();
    const unchanged = async () => {
        for (const [id, value] of expected) assert.equal(await h.database.prepare('SELECT edited_at FROM contents WHERE id=?').bind(id).first('edited_at'), value, id);
    };
    for (const id of [q, a, c]) for (const value of [1, -1, 0]) {
        assert.equal((await h.api('PUT', `/contents/${id}/vote`, 'visitor', { value })).status, 200);
        await unchanged();
    }
    await h.policy();
    for (const answer of [a, a, null, a]) {
        assert.equal((await h.accept(q, answer)).status, 200); await unchanged();
    }
    for (const deltaPoints of [25, -10]) {
        assert.equal((await h.api('POST', '/courses/course-a/bonus-adjustments', 'teacher-a',
            { studentId: 'student-b', termId: 'term-active', deltaPoints })).status, 201);
        await unchanged();
    }
    await h.database.prepare("INSERT INTO file_versions(material_id,version,filename,uploaded_by,updated_by) VALUES ('material-a',4,'v4.pdf','student-a','student-a')").run();
    await unchanged();
    for (const status of ['hidden', 'visible']) {
        await h.database.prepare("UPDATE file_versions SET status=? WHERE material_id='material-a' AND version=4").bind(status).run();
        await unchanged();
    }
    for (const id of expected.keys()) {
        await hide(id); await unchanged();
        await restore(id); await unchanged();
        assert.equal((await detail(id)).editedAt, expected.get(id));
    }
    for (const id of expected.keys()) {
        await remove(id); await unchanged();
        const placeholder = await detail(id);
        assert.equal(placeholder.status, 'deleted'); assert.equal(placeholder.editedAt, expected.get(id));
    }
});

test('replyTo distinguishes deleted content from deleted authors and reads current nullable nicknames', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q, 'student-a'), c = await comment(q, 'student-a');
    const pairs = [];
    for (const parent of [q, a, c, 'material-a']) pairs.push([parent, await comment(parent)]);
    await h.database.prepare("UPDATE accounts SET nickname=NULL WHERE id='student-a'").run();
    for (const [parent, reply] of pairs) assert.deepEqual((await detail(reply)).replyTo,
        { id: parent, author: { nickname: null, isDeleted: false }, isDeleted: false });
    await h.database.prepare("UPDATE accounts SET nickname='新昵称' WHERE id='student-a'").run();
    for (const [parent, reply] of pairs) {
        await remove(parent);
        assert.deepEqual((await detail(reply)).replyTo, { id: parent, author: { nickname: '新昵称', isDeleted: false }, isDeleted: true });
    }
    await h.database.prepare("UPDATE accounts SET status='deleted' WHERE id='student-a'").run();
    for (const [parent, reply] of pairs) {
        const expected = { id: parent, author: { nickname: '已删除', isDeleted: true }, isDeleted: true };
        assert.deepEqual((await detail(reply)).replyTo, expected);
        const list = await h.api('GET', `/comments?targetKind=${(await detail(parent)).kind}&targetId=${parent}`);
        assert.deepEqual(list.data.items.find(row => row.id === reply).replyTo, expected);
    }
    const owned = await h.postQuestion('visitor'), reply = await comment(owned);
    await h.database.prepare("UPDATE accounts SET status='deleted' WHERE id='visitor'").run();
    assert.deepEqual((await detail(reply)).replyTo, { id: owned, author: { nickname: '已删除', isDeleted: true }, isDeleted: false });
    const answerPlaceholder = await detail(a);
    assert.deepEqual(answerPlaceholder.replyTo, { id: q, author: { nickname: '已删除', isDeleted: true }, isDeleted: true });
});

test('counts match public list totals through nested replies, hidden branches, deleted parents and pagination', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q), hiddenAnswer = await h.postAnswer(q), deletedAnswer = await h.postAnswer(q);
    const visible = await comment(q), child = await comment(visible), hidden = await comment(q), hiddenChild = await comment(hidden);
    const deleted = await comment(q), survivor = await comment(deleted), grandchild = await comment(survivor);
    const answerComment = await comment(a), answerReply = await comment(answerComment);
    const materialComment = await comment('material-a'), materialReply = await comment(materialComment);
    const hiddenAnswerComment = await comment(hiddenAnswer), deletedAnswerComment = await comment(deletedAnswer);
    await hide(hiddenAnswer); const hiddenRevision = await hide(hidden);
    await remove(deletedAnswer); await remove(deleted);
    const checkComments = async (id, count) => {
        const row = await detail(id), list = await h.api('GET', `/comments?targetKind=${row.kind}&targetId=${id}&pageSize=1`);
        assert.equal(list.status, 200); assert.equal(row.commentCount, count, id); assert.equal(row.commentCount, list.data.total, id);
        assert.equal(list.data.items.length, Math.min(count, 1));
    };
    await checkComments(q, 4); await checkComments(visible, 1); await checkComments(child, 0);
    await checkComments(deleted, 2); await checkComments(survivor, 1); await checkComments(grandchild, 0);
    await checkComments(a, 2); await checkComments(answerComment, 1); await checkComments(answerReply, 0);
    await checkComments('material-a', 2); await checkComments(materialComment, 1); await checkComments(materialReply, 0);
    await checkComments(deletedAnswer, 1); await checkComments(deletedAnswerComment, 0);
    const answers = await h.api('GET', `/questions/${q}/answers?pageSize=1`);
    assert.equal((await detail(q)).answerCount, 1); assert.equal(answers.data.total, 1);
    const listedQuestion = (await h.api('GET', '/courses/course-a/questions')).data.items.find(row => row.id === q);
    assert.equal(listedQuestion.answerCount, 1); assert.equal(listedQuestion.commentCount, 4);
    for (const id of [hiddenAnswer, hiddenAnswerComment, hidden, hiddenChild]) assert.equal((await h.api('GET', `/contents/${id}`)).status, 404);
    await restore(hidden, hiddenRevision); await checkComments(q, 6);
    await remove(hidden); await checkComments(q, 5);
    await remove(q); await checkComments(q, 5);
    const placeholder = (await h.api('GET', `/questions/${q}`)).data;
    assert.equal(placeholder.status, 'deleted'); assert.equal(placeholder.answerCount, 1); assert.equal(placeholder.commentCount, 5);
    const empty = await h.postQuestion();
    assert.equal((await detail(empty)).answerCount, 0); await checkComments(empty, 0);
});

test('OpenAPI describes nullable editing time, reply summaries and question-only answer counts', () => {
    const { Content, Tombstone, ReplyTo } = openapi.components.schemas;
    for (const schema of [Content, Tombstone]) {
        for (const field of ['editedAt', 'replyTo', 'commentCount']) assert.ok(schema.required.includes(field));
        assert.deepEqual(schema.properties.editedAt.type, ['integer', 'null']);
        assert.deepEqual(schema.properties.replyTo.anyOf, [{ $ref: '#/components/schemas/ReplyTo' }, { type: 'null' }]);
        assert.equal(schema.properties.commentCount.minimum, 0); assert.equal(schema.properties.answerCount.minimum, 0);
        assert.deepEqual(schema.allOf[0].then.required, ['answerCount']);
    }
    assert.deepEqual(ReplyTo.required, ['id', 'author', 'isDeleted']);
    assert.deepEqual(ReplyTo.properties.author.required, ['nickname', 'isDeleted']);
});