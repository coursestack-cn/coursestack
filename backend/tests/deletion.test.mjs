import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, doc } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const moderate = (id, action, as = 'teacher-a') => h.api('PUT', `/contents/${id}/moderation`, as, { action, reason: '审查确认处理依据' });
const balance = () => h.database.prepare('SELECT COALESCE(SUM(delta_points),0) AS n FROM bonus_ledger').first('n');
async function comment(targetId, targetKind, as = 'student-b') {
    const result = await h.api('POST', '/comments', as, { targetId, targetKind, body: doc('讨论内容') });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.id;
}

test('owner deletion is blocked by hidden discussion or acceptance; unrelated managers cannot bypass it', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    assert.equal((await h.api('DELETE', `/contents/${q}`, 'student-a')).status, 409);
    await moderate(a, 'hide');
    assert.equal((await h.api('GET', `/questions/${q}`, 'student-a')).data.canDelete, false);
    assert.equal((await h.api('DELETE', `/contents/${q}`, 'student-a')).status, 409);
    await moderate(a, 'restore'); await h.accept(q, a);
    assert.equal((await h.api('DELETE', `/contents/${a}`, 'student-b')).status, 409);
    assert.equal((await h.api('PUT', `/questions/${q}/acceptance`, 'teacher-a', { answerId: null })).status, 200);
    assert.equal((await h.api('GET', `/contents/${a}`, 'student-b')).data.canDelete, true);
    const c = await comment(a, 'answer');
    await moderate(c, 'hide');
    assert.equal((await h.api('DELETE', `/contents/${a}`, 'student-b')).status, 409);
    assert.equal((await moderate(q, 'delete', 'student-a')).status, 403);
    assert.equal((await moderate(q, 'delete', 'teacher-b')).status, 403);
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'teacher-a', { body: doc('改写') })).status, 403);
});

test('comments are peers: hiding and deleting one leaves replies and their rewards intact', async () => {
    await h.policy({ pointsComment: 2 });
    const q = await h.postQuestion(), first = await comment(q, 'question'), reply = await comment(first, 'comment');
    const nested = await comment(reply, 'comment');
    assert.equal(await balance(), 6);
    assert.deepEqual(await h.database.prepare('SELECT target_id,reply_to_id FROM contents WHERE id=?').bind(nested).first(), { target_id: q, reply_to_id: reply });
    await moderate(first, 'hide');
    assert.equal(await balance(), 4);
    assert.equal((await h.api('GET', `/contents/${reply}`)).status, 200);
    assert.equal((await h.api('DELETE', `/contents/${first}`, 'student-b')).status, 200);
    assert.equal(await balance(), 4);
    assert.equal((await h.api('GET', `/contents/${nested}`)).status, 200);
    assert.equal((await moderate(first, 'restore')).status, 409);
    assert.equal((await h.api('GET', `/contents/${reply}`)).data.replyTo.isDeleted, true);
});

test('manager deletion cascades through question ownership, preserves manual points and notifies every affected author', async () => {
    await h.policy({ pointsQuestion: 3, pointsAnswer: 5, pointsComment: 2, pointsAcceptance: 7 });
    await h.database.prepare("INSERT INTO teaching_classes VALUES('course-a','term-active','teacher-b')").run();
    const q = await h.postQuestion(), a = await h.postAnswer(q), c = await comment(q, 'question'), r = await comment(a, 'answer');
    const peer = await comment(r, 'comment'), unaffected = await h.postQuestion();
    await h.accept(q, a);
    await h.api('POST', '/courses/course-a/terms/term-active/teachers/teacher-a/bonus-adjustments', 'teacher-a', { studentId: 'student-b', deltaPoints: 9 });
    const before = await balance();
    assert.equal((await moderate(q, 'delete', 'teacher-b')).status, 200);
    assert.equal(await balance(), 12); assert.ok(before > 12);
    for (const id of [q, a, c, r, peer]) {
        assert.deepEqual(await h.database.prepare('SELECT status,body,title,tags FROM contents WHERE id=?').bind(id).first(), { status: 'deleted', body: null, title: null, tags: null });
        assert.equal((await h.api('GET', `/contents/${id}`, id === q ? 'student-a' : 'student-b')).status, 404);
    }
    assert.equal((await h.api('GET', `/questions/${unaffected}`)).status, 200);
    assert.equal((await h.api('GET', '/notifications', 'student-b')).data.items.filter(n => n.status === 'deleted').length, 4);
    assert.equal(await h.database.prepare('SELECT COUNT(*) n FROM acceptances').first('n'), 0);
    const rows = await h.database.prepare('SELECT COUNT(*) n FROM bonus_ledger').first('n');
    assert.equal((await moderate(q, 'delete')).status, 409);
    assert.equal(await h.database.prepare('SELECT COUNT(*) n FROM bonus_ledger').first('n'), rows);
    assert.deepEqual((await h.database.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('a deletion report, descendants, notifications and point reversals commit atomically', async () => {
    await h.policy({ pointsQuestion: 5, pointsAnswer: 3 });
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    const report = await h.api('POST', `/contents/${q}/reports`, 'student-b', { reason: '内容需要管理者删除' });
    const path = `/moderation/reports/${report.data.id}`, input = { action: 'delete', resolution: '确认删除及其所属讨论' };
    const noticesBefore = (await h.api('GET', '/notifications?status=all', 'student-a')).data.items;
    await h.database.prepare("CREATE TRIGGER deletion_failure BEFORE INSERT ON bonus_ledger BEGIN SELECT RAISE(ABORT,'failure'); END").run();
    assert.equal((await h.api('PATCH', path, 'teacher-a', input)).status, 500);
    assert.equal((await h.api('GET', `/contents/${a}`)).status, 200);
    assert.equal(await balance(), 8);
    assert.deepEqual((await h.api('GET', '/notifications?status=all', 'student-a')).data.items, noticesBefore);
    assert.equal((await h.api('GET', '/moderation/reports', 'teacher-a')).data.items[0].status, 'pending');
    await h.database.prepare('DROP TRIGGER deletion_failure').run();
    assert.equal((await h.api('PATCH', path, 'teacher-a', input)).status, 200);
    assert.equal((await h.api('GET', '/moderation/reports?status=deleted', 'teacher-a')).data.items[0].status, 'deleted');
    assert.equal(await balance(), 0);
});

test('last version cannot be removed by owners, managers or racing requests; deleting a material removes files and comments', async () => {
    const material = 'material-a';
    await h.env.FILES.put('fixtures/material-a/1', 'fixture');
    await h.env.FILES.put('fixtures/material-a/2', 'fixture');
    const c = await comment(material, 'material');
    assert.equal((await h.api('DELETE', `/contents/${material}`, 'student-a')).status, 409);
    const versionPath = `/materials/${material}/versions`;
    assert.equal((await h.api('DELETE', `${versionPath}/2`, 'teacher-a', { reason: '移除错误的文件版本' })).status, 200);
    assert.equal((await h.api('GET', '/notifications', 'student-a')).data.items[0].version, 2);
    for (const as of ['student-a', 'teacher-a', 'admin']) {
        assert.equal((await h.api('DELETE', `${versionPath}/1`, as, { reason: '不允许留下空资料' })).status, 409);
    }
    await assert.rejects(h.database.prepare("DELETE FROM file_versions WHERE material_id='material-a'").run(), /material_last_version/);
    assert.equal((await moderate(material, 'delete')).status, 200);
    assert.equal(await h.database.prepare("SELECT COUNT(*) n FROM file_versions WHERE material_id='material-a'").first('n'), 0);
    assert.equal(await h.database.prepare('SELECT status FROM contents WHERE id=?').bind(c).first('status'), 'deleted');
    assert.equal(await h.env.FILES.head('fixtures/material-a/1'), null);
    assert.equal(await h.env.FILES.head('fixtures/material-a/2'), null);
});


test('simultaneous version deletions leave one published version', async () => {
    const results = await Promise.all([1, 2].map(version => h.api('DELETE', `/materials/material-a/versions/${version}`, 'student-a')));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(await h.database.prepare("SELECT COUNT(*) n FROM file_versions WHERE material_id='material-a'").first('n'), 1);
    assert.equal((await h.api('GET', '/materials/material-a')).status, 200);
});