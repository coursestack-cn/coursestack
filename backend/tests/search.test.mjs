import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, doc, linkDoc, tokenFor } from './discussions-helpers.mjs';
import { backfillSearchText } from '../scripts/lib/search-backfill.mjs';
import { bodySearchText } from '../src/search/text.ts';
import { parseSearchQuery, highlightRanges, searchExcerpt } from '../../shared/search.ts';
let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const search = async (q, filters = {}, as) => {
    const response = await h.api('GET', '/search?' + new URLSearchParams({ q, ...filters }), as);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
};
const ids = result => result.items.map(item => item.id);
const moderate = async (id, action) => {
    const response = await h.api('PUT', '/contents/' + id + '/moderation', 'teacher-a', { action });
    assert.equal(response.status, 200, JSON.stringify(response.data));
};
test('searches courses, filenames, rich text and tags without indexing comment or answer context', async () => {
    await h.api('PATCH', '/courses/course-a', 'admin', { introduction: '课程介绍独特词' });
    const question = await h.postQuestion('student-a', { title: '积分例题', tags: ['期末复习'], body: doc('数组求解') });
    const answer = await h.postAnswer(question, 'student-b', doc('用积分完成推导'));
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'question', targetId: question, body: doc('评论独特词') });
    assert.equal(comment.status, 201);
    assert.deepEqual(ids(await search('课程介绍独特词')), ['course-a']);
    assert.deepEqual(ids(await search('COURSE-A')), ['course-a']);
    assert.deepEqual(ids(await search('讲义', { type: 'material' })), ['material-a', 'material-b']);
    assert.equal((await search('积分', { type: 'material' })).total, 1); // Two versions, one result.
    assert.deepEqual(ids(await search('积分例题')), [question]); // Parent title does not recall its answers.
    assert.deepEqual(ids(await search('期末')), [question]);
    assert.deepEqual(ids(await search('积分', { type: 'answer', tag: '末复' })), [answer]);
    const result = (await search('推导')).items[0];
    assert.equal(result.title, '积分例题'); assert.equal(result.questionId, question);
    assert.deepEqual(result.tags, ['期末复习']); assert.deepEqual(result.highlights.title, []);
    assert.equal((await search('评论独特词')).total, 0);
    assert.equal('body' in result, false); assert.equal('body_text' in result, false);
    assert.equal('schoolNumber' in result.author, false);
});
test('supports short Chinese, ASCII case folding, multiword AND and literal SQL punctuation', async () => {
    const question = await h.postQuestion('student-a', { title: "数组_100% SQL'例题", body: doc('树与正态分布') });
    for (const q of ['树', '数组', 'sql', '_', '%', "SQL'"]) assert.ok(ids(await search(q)).includes(question), q);
    assert.deepEqual(ids(await search('数组 正态')), [question]);
    assert.equal((await search('数组 不存在')).total, 0);
    assert.equal((await search("' OR 1=1 --")).total, 0);
    assert.equal((await search('树', { course: 'course-b' })).total, 0);
    assert.equal((await search('树', { type: 'material' })).total, 0);
    const allTerms = await search('数组 树 正态 分布 SQL _ % 例题');
    assert.deepEqual(ids(allTerms), [question]);
});
test('validates query bounds and incompatible filters, including direct anonymous URLs', async () => {
    assert.equal((await search('   ')).total, 0);
    const invalid = [
        { q: '字'.repeat(101) }, { q: 'a b c d e f g h i' }, { q: '数组', type: 'comment' },
        { q: '数组', sort: 'score' }, { q: '数组', course: '..' }, { q: '数组', tag: '字'.repeat(31) },
        { q: '数组', type: 'course', tag: '标签' }, { q: '数组', page: '0' }, { q: '数组', pageSize: '51' },
    ];
    for (const filters of invalid) {
        const response = await h.api('GET', '/search?' + new URLSearchParams(filters));
        assert.equal(response.status, 400, JSON.stringify(filters));
    }
    assert.equal(parseSearchQuery(' 😀 '.repeat(8)).error, null);
    assert.equal((await search('字'.repeat(100))).total, 0);
});
test('ranks exact titles before title, tag and body matches and paginates after all filters', async () => {
    const exact = await h.postQuestion('student-a', { title: '矩阵', body: doc('讲解') });
    const title = await h.postQuestion('student-a', { title: '矩阵练习', body: doc('讲解') });
    const tag = await h.postQuestion('student-a', { title: '复习资料', tags: ['矩阵'], body: doc('讲解') });
    const body = await h.postQuestion('student-a', { title: '计算方法', body: doc('矩阵'.repeat(100)) });
    for (const [index, id] of [exact, title, tag, body].entries()) {
        await h.database.prepare('UPDATE contents SET updated_at=? WHERE id=?').bind(100 + index, id).run();
    }
    assert.deepEqual(ids(await search('矩阵')), [exact, title, tag, body]);
    const first = await search('矩阵', { pageSize: '2' }), second = await search('矩阵', { pageSize: '2', page: '2' });
    assert.equal(first.total, 4); assert.equal(second.total, 4);
    assert.deepEqual([...ids(first), ...ids(second)], [exact, title, tag, body]);
    assert.deepEqual(ids(await search('矩阵', { sort: 'updated' })), [body, tag, title, exact]);
    assert.deepEqual(ids(await search('矩阵', { tag: '矩', pageSize: '1' })), [tag]);
    assert.equal((await search('矩阵', { page: '10000' })).items.length, 0);
});
test('extracts full rich text across formatting, excludes attributes and produces safe Unicode highlights', async () => {
    const rich = { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '数', marks: [{ type: 'bold' }] }, { type: 'text', text: '组' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文'.repeat(300) }] },
        { type: 'paragraph', content: [{ type: 'text', text: '😀末尾MATCH<script>', marks: [{ type: 'link', attrs: { href: 'https://example.com/secret-url-token' } }] }] },
    ] };
    const question = await h.postQuestion('student-a', { title: '安全摘要', body: rich });
    assert.deepEqual(ids(await search('数组')), [question]);
    const item = (await search('😀末尾match')).items[0];
    assert.ok(item.excerpt.includes('😀末尾MATCH<script>')); assert.ok(item.excerpt.startsWith('…'));
    for (const [start, end] of item.highlights.excerpt) assert.equal(item.excerpt.slice(start, end), '😀末尾MATCH');
    for (const q of ['paragraph', 'secret-url-token']) assert.equal((await search(q)).total, 0);
    assert.equal(bodySearchText({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/image.png' } }] }), '');
    assert.deepEqual(highlightRanges('😀ABaba', ['ab', 'aba']), [[2, 7]]);
    assert.equal(searchExcerpt('🙂'.repeat(200), ['🙂'], 10), '🙂'.repeat(10) + '…');
});
test('edits replace indexed words atomically and title-only edits retain the full body', async () => {
    const question = await h.postQuestion('student-a', { title: '编辑测试', body: doc('旧关键词') });
    assert.deepEqual(ids(await search('旧关键词')), [question]);
    assert.equal((await h.api('PATCH', '/contents/' + question, 'student-a', { body: doc('新关键词') })).status, 200);
    assert.equal((await search('旧关键词')).total, 0);
    assert.deepEqual(ids(await search('新关键词')), [question]);
    assert.equal((await h.api('PATCH', '/contents/' + question, 'student-a', { title: '新的标题' })).status, 200);
    assert.deepEqual(ids(await search('新关键词')), [question]);
    assert.equal((await h.api('DELETE', '/contents/' + question, 'student-a')).status, 200);
    assert.equal(await h.database.prepare('SELECT body_text FROM contents WHERE id=?').bind(question).first('body_text'), '');
    assert.equal((await search('新关键词')).total, 0);
});
test('parent hiding removes descendants for guests, owners and managers; restoration and deletion stay consistent', async () => {
    const question = await h.postQuestion('student-a', { title: '公开分支词', body: doc('分支正文') });
    const answer = await h.postAnswer(question, 'student-b', doc('公开分支词'));
    assert.equal((await search('公开分支词')).total, 2);
    await moderate(question, 'hide');
    for (const viewer of [undefined, 'student-a', 'student-b', 'teacher-a', 'admin']) assert.equal((await search('公开分支词', {}, viewer)).total, 0);
    await h.api('PATCH', '/contents/' + question, 'student-a', { body: doc('隐藏编辑词') });
    assert.equal((await search('隐藏编辑词', {}, 'student-a')).total, 0);
    await moderate(question, 'restore');
    assert.equal((await search('公开分支词')).total, 2);
    assert.deepEqual(ids(await search('隐藏编辑词')), [question]);
    await moderate(question, 'delete');
    assert.equal((await search('公开分支词')).total, 0);
    const rows = (await h.database.prepare('SELECT id,body_text FROM contents WHERE id IN (?,?)').bind(question, answer).all()).results;
    assert.ok(rows.every(row => row.body_text === ''));
});
test('material publication, new versions, renaming and description edits keep one searchable result', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\nfixture\n%%EOF');
    async function publish(data) {
        const ticket = await h.api('POST', '/material-uploads', 'student-a', { ...data, file: { size: pdf.length, type: 'application/pdf' } });
        assert.equal(ticket.status, 201);
        const sent = await h.worker.fetch(ticket.data.url, { method: 'PUT', headers: { Origin: 'http://localhost', Cookie: 'coursestack_session=' + tokenFor('student-a'), ...ticket.data.headers }, body: pdf });
        assert.equal(sent.status, 204);
        const confirmed = await h.api('POST', '/material-uploads/' + ticket.data.uploadId + '/confirm', 'student-a');
        assert.equal(confirmed.status, 200);
        return confirmed.data.materialId;
    }
    const id = await publish({ mode: 'create', courseId: 'course-a', title: '检索文件.pdf', body: doc('发布时介绍词') });
    assert.deepEqual(ids(await search('发布时介绍词')), [id]);
    await publish({ mode: 'version', materialId: id });
    assert.equal((await search('检索文件')).total, 1);
    await h.api('PATCH', '/materials/' + id, 'student-a', { title: '改名后.pdf', body: doc('修改后介绍词') });
    assert.equal((await search('检索文件')).total, 0);
    assert.equal((await search('发布时介绍词')).total, 0);
    assert.deepEqual(ids(await search('修改后介绍词')), [id]);
});
test('backfill includes hidden legacy content, preserves timestamps and ledger, and is idempotent', async () => {
    await h.policy({ pointsQuestion: 3 });
    const id = await h.postQuestion('student-a', { body: doc('存量索引词') });
    await moderate(id, 'hide');
    await h.database.prepare('UPDATE contents SET body_text=? WHERE id=?').bind('', id).run();
    const before = await h.database.prepare('SELECT body,updated_at,edited_at,request_hash FROM contents WHERE id=?').bind(id).first();
    const ledger = (await h.database.prepare('SELECT * FROM bonus_ledger').all()).results;
    assert.equal((await backfillSearchText(h.database, { check: true, batchSize: 1 })).mismatches, 1);
    assert.equal((await backfillSearchText(h.database, { batchSize: 1 })).updated, 1);
    assert.equal((await backfillSearchText(h.database)).updated, 0);
    assert.equal((await backfillSearchText(h.database, { check: true })).mismatches, 0);
    assert.deepEqual(await h.database.prepare('SELECT body,updated_at,edited_at,request_hash FROM contents WHERE id=?').bind(id).first(), before);
    assert.deepEqual((await h.database.prepare('SELECT * FROM bonus_ledger').all()).results, ledger);
    assert.equal((await search('存量索引词')).total, 0);
    await moderate(id, 'restore');
    assert.deepEqual(ids(await search('存量索引词')), [id]);
});
test('backfill cannot overwrite a concurrent body edit', async () => {
    const id = await h.postQuestion('student-a', { body: doc('回填旧词') });
    await h.database.prepare('UPDATE contents SET body_text=? WHERE id=?').bind('', id).run();
    let calls = 0;
    const database = { prepare: (...args) => h.database.prepare(...args), batch: async statements => {
        calls++;
        if (calls === 2) await h.api('PATCH', '/contents/' + id, 'student-a', { body: doc('并发新词') });
        return h.database.batch(statements);
    } };
    assert.equal((await backfillSearchText(database)).updated, 0);
    assert.equal((await search('回填旧词')).total, 0);
    assert.deepEqual(ids(await search('并发新词')), [id]);
});
test('deleted authors retain public content without exposing their identity', async () => {
    const id = await h.postQuestion('student-a', { body: doc('作者删除后') });
    await h.database.prepare("UPDATE accounts SET status='deleted' WHERE id='student-a'").run();
    const item = (await search('作者删除后')).items[0];
    assert.equal(item.id, id); assert.equal(item.author.id, null);
    assert.equal(item.author.nickname, '已删除'); assert.equal(item.author.avatarUrl, null);
});