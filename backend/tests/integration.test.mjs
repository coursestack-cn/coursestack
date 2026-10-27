import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, internalToken, tokenFor, doc, linkDoc } from './discussions-helpers.mjs';
let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const headers = { Authorization: `Bearer ${internalToken}` };
const internal = (method        , path        , data          ) => h.api(method, path, undefined, data, { internal: true, headers });
test('内部服务凭据与用户会话隔离，普通用户和裸 Token 不能读取内部文档', async () => {
    assert.equal((await h.api('GET', '/internal/documents', undefined, undefined, { internal: true })).status, 401);
    assert.equal((await h.api('GET', '/internal/documents', 'admin', undefined, { internal: true })).status, 401);
    assert.equal((await h.api('GET', '/internal/documents', undefined, undefined, { internal: true, headers: { Authorization: internalToken } })).status, 401);
    assert.equal((await internal('GET', '/internal/documents')).status, 200);
});
test('事件接口已移除，内容、课程和文档不再携带版本字段', async () => {
    const q = await h.postQuestion();
    assert.equal((await internal('GET', '/internal/events')).status, 404);
    assert.equal((await internal('POST', '/internal/events/ack', { eventIds: ['removed'] })).status, 404);
    for (const response of [await h.api('GET', '/courses/course-a'), await h.api('GET', '/contents/' + q),
        await h.api('GET', '/moderation/contents/' + q, 'teacher-a'), await internal('GET', '/internal/contents/' + q)]) {
        assert.equal(response.status, 200); assert.equal('revision' in response.data, false);
    }
    const documents = await internal('GET', '/internal/documents');
    assert.equal('watermark' in documents.data, false);
    assert.ok(documents.data.items.every(item => !('revision' in item)));
});
test('文档分页提供可见课程、资料和问答；文件不可用不丢失讨论文档', async () => {
    const q = await h.postQuestion('student-a', { body: linkDoc('讲义', '/materials/material-a/versions/1') }), a = await h.postAnswer(q);
    const page1 = await internal('GET', '/internal/documents?limit=1'); assert.equal(page1.data.hasMore, true);
    const page2 = await internal('GET', '/internal/documents?limit=100&after=' + encodeURIComponent(page1.data.nextCursor));
    const ids = [...page1.data.items, ...page2.data.items].map((x     ) => x.id);
    assert.ok([q, a, 'material-a', 'material-b'].every(id => ids.includes(id))); assert.equal(new Set(ids).size, ids.length);
    await h.database.prepare("UPDATE file_versions SET status='hidden' WHERE material_id='material-a' AND version=1").run();
    assert.equal((await internal('GET', `/internal/contents/${q}`)).data.available, true);
    await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide', reason: '下架讨论内容' });
    assert.equal((await internal('GET', `/internal/contents/${q}`)).data.available, false);
    assert.equal((await internal('GET', `/internal/contents/${a}`)).data.available, false);
    const visible = await internal('GET', '/internal/documents');
    assert.ok(visible.data.items.every(item => item.id !== q && item.id !== a));
});
test('个人空间限定本人，教师加分报表限定课程且支持学期筛选', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    assert.equal((await h.api('GET', '/me/activity?kind=answer', 'student-a')).data.items.length, 0);
    assert.equal((await h.api('GET', '/me/activity?kind=answer', 'student-b')).data.items[0].id, a);
    assert.equal((await h.api('GET', '/me/bonus-ledger', 'student-a')).data.items.length, 0);
    assert.equal((await h.api('GET', '/me/bonus-ledger', 'student-b')).data.items[0].deltaPoints, 50);
    assert.equal((await h.api('GET', '/courses/course-a/bonus-summary?termId=term-active', 'teacher-a')).data.items[0].totalPoints, 50);
    assert.equal((await h.api('GET', '/courses/course-a/bonus-ledger?termId=term-old', 'teacher-a')).data.items.length, 0);
    assert.equal((await h.api('GET', '/courses/course-a/bonus-summary', 'teacher-b')).status, 403);
});
test('模拟写入流水失败时，采纳状态和奖励一起回滚', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q);
    await h.database.prepare("CREATE TRIGGER fail_ledger BEFORE INSERT ON bonus_ledger BEGIN SELECT RAISE(ABORT,'simulated_failure'); END;").run();
    const r = await h.accept(q, a); assert.equal(r.status, 500);
    assert.equal((await h.api('GET', `/questions/${q}`)).data.solved, false);
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM bonus_ledger').first('n'), 0);
});
test('课程创建时授课关系失败，课程及默认积分规则整体回滚', async () => {
    await h.database.prepare("CREATE TRIGGER fail_teaching BEFORE INSERT ON enrollments BEGIN SELECT RAISE(ABORT,'simulated_failure'); END;").run();
    const r = await h.api('POST', '/courses', 'teacher-a', { name: '回滚课程', code: 'ROLLBACK1' });
    assert.equal(r.status, 500);
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM courses WHERE code='ROLLBACK1'").first('n'), 0);
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM course_bonus_rules').first('n'), 2);
});
test('删除问题撤销奖励并阻止后续回答，管理员可以跨课程审查', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    assert.equal((await h.api('GET', `/moderation/contents/${q}`, 'admin')).status, 200);
    assert.equal((await h.api('DELETE', `/contents/${q}`, 'student-a', { })).status, 200);
    assert.equal((await h.api('POST', `/questions/${q}/answers`, 'student-b', { body: doc('删除后回复') })).status, 404);
    assert.equal(await h.database.prepare('SELECT SUM(delta_points) AS n FROM bonus_ledger').first('n'), 0);
    assert.equal((await h.api('GET', `/contents/${q}`)).data.status, 'deleted');
});
test('数据库拒绝跨问题采纳及内容身份迁移', async () => {
    const q1 = await h.postQuestion(), q2 = await h.postQuestion(), a = await h.postAnswer(q1);
    await assert.rejects(() => h.database.prepare("INSERT INTO acceptances(answer_id,question_id,operator_id) VALUES (?,?,'teacher-a')").bind(a, q2).run(), /invalid_acceptance/);
    await assert.rejects(() => h.database.prepare("UPDATE contents SET course_id='course-b' WHERE id=?").bind(q1).run(), /content_identity_immutable/);
});
test('无效加分小数和过大正文被拒绝，报错不返回SQL或令牌', async () => {
    const invalid = await h.api('PUT', '/courses/course-a/bonus-policy', 'teacher-a', { pointsQuestion: 0, pointsAnswer: 2.345, pointsAcceptance: 0, pointsComment: 0, pointsMaterial: 0, pointsMaterialVersion: 0 });
    assert.equal(invalid.status, 400);
    const large = await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '过大正文', body: doc('中'.repeat(50000)) });
    assert.equal(large.status, 413);
    for (const r of [invalid, large]) assert.ok(!JSON.stringify(r.data).includes('local-teacher-a-token'));
});

test('课程动态直接列出当前可见内容，编辑后仍只出现一次并按更新时间排序', async () => {
    const first = await h.postQuestion('student-a', { title: '原标题' }), second = await h.postQuestion();
    await h.database.prepare('UPDATE contents SET updated_at=1').run();
    await h.api('PATCH', '/contents/' + first, 'student-a', { title: '最新标题' });
    await h.api('PATCH', '/contents/' + first, 'student-a', { tags: ['更新标签'] });
    const page = await h.api('GET', '/courses/course-a/activity');
    assert.equal(page.status, 200);
    assert.equal(page.data.items[0].contentId, first); assert.equal(page.data.items[0].title, '最新标题');
    assert.equal(page.data.items.filter(item => item.contentId === first).length, 1);
    assert.ok(page.data.items.every(item => !('seq' in item) && !('type' in item) && Number.isInteger(item.updatedAt)));
    await h.api('PUT', '/contents/' + first + '/moderation', 'teacher-a', { action: 'hide', reason: '隐藏动态内容' });
    await h.api('DELETE', '/contents/' + second, 'student-a');
    const current = await h.api('GET', '/courses/course-a/activity');
    assert.ok(current.data.items.every(item => ![first, second].includes(item.contentId)));
});