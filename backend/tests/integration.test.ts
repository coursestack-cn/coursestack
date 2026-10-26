import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, internalToken, type Harness } from './harness';
let h: Harness;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const headers = { Authorization: `Bearer ${internalToken}` };
const internal = (method: string, path: string, data?: unknown) => h.api(method, path, undefined, data, { internal: true, headers });
test('内部服务凭据与用户会话隔离，普通用户和裸 Token 不能读取事件', async () => {
  assert.equal((await h.api('GET', '/internal/events', undefined, undefined, { internal: true })).status, 401);
  assert.equal((await h.api('GET', '/internal/events', 'admin', undefined, { internal: true })).status, 401);
  assert.equal((await h.api('GET', '/internal/events', undefined, undefined, { internal: true, headers: { Authorization: internalToken } })).status, 401);
  assert.equal((await internal('GET', '/internal/events')).status, 200);
});
test('事务事件稳定分页、载明直接通知对象；确认可重试且不删除事件', async () => {
  const q = await h.postQuestion(), a = await h.postAnswer(q);
  await h.api('POST', '/comments', 'teacher-a', { targetKind: 'answer', targetId: a, body: '教师评论' });
  const first = await internal('GET', '/internal/events?after=0&limit=2');
  assert.equal(first.data.items.length, 2); assert.equal(first.data.hasMore, true);
  const second = await internal('GET', `/internal/events?after=${first.data.nextCursor}&limit=100`);
  assert.ok(second.data.items.every((e: any) => e.seq > first.data.nextCursor));
  const answerEvent = second.data.items.find((e: any) => e.contentId === a);
  assert.equal(answerEvent.payload.questionAuthorId, 'student-a'); assert.equal(answerEvent.actorId, 'student-b');
  const commentEvent = second.data.items.find((e: any) => e.type === 'comment.created');
  assert.equal(commentEvent.payload.targetAuthorId, 'student-b');
  const ids = second.data.items.map((e: any) => e.eventId);
  assert.equal((await internal('POST', '/internal/events/ack', { eventIds: ids })).data.acknowledged, ids.length);
  assert.equal((await internal('POST', '/internal/events/ack', { eventIds: ids })).data.acknowledged, 0);
  assert.equal((await internal('POST', '/internal/events/ack', { eventIds: ['does-not-exist'] })).data.acknowledged, 0);
  assert.equal((await internal('GET', `/internal/events?after=${first.data.nextCursor}`)).data.items.length, ids.length);
});
test('搜索快照仅提供可见课程和问答；文件不可用不丢失讨论文档', async () => {
  const q = await h.postQuestion('student-a', { fileVersionId: 'version-a1' }), a = await h.postAnswer(q);
  const page1 = await internal('GET', '/internal/documents?limit=1'); assert.equal(page1.data.hasMore, true);
  const page2 = await internal('GET', '/internal/documents?limit=100&after=' + encodeURIComponent(page1.data.nextCursor));
  const ids = [...page1.data.items, ...page2.data.items].map((x: any) => x.id);
  assert.ok(ids.includes(q) && ids.includes(a)); assert.equal(new Set(ids).size, ids.length);
  await h.database.prepare("UPDATE file_versions SET status='hidden' WHERE id='version-a1'").run();
  assert.equal((await internal('GET', `/internal/contents/${q}`)).data.available, true);
  await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '下架讨论内容' });
  assert.equal((await internal('GET', `/internal/contents/${q}`)).data.available, false);
  assert.equal((await internal('GET', `/internal/contents/${a}`)).data.available, false);
  const events = await internal('GET', `/internal/events?after=${page1.data.watermark}`);
  assert.ok(events.data.items.some((e: any) => e.contentId === q && e.type === 'question.hidden'));
});
test('个人空间限定本人，教师加分报表限定课程且支持学期筛选', async () => {
  await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
  assert.equal((await h.api('GET', '/me/activity?kind=answer', 'student-a')).data.items.length, 0);
  assert.equal((await h.api('GET', '/me/activity?kind=answer', 'student-b')).data.items[0].id, a);
  assert.equal((await h.api('GET', '/me/bonus-ledger', 'student-a')).data.items.length, 0);
  assert.equal((await h.api('GET', '/me/bonus-ledger', 'student-b')).data.items[0].deltaPoints, 2);
  assert.equal((await h.api('GET', '/courses/course-a/bonus-summary?semesterId=term-active', 'teacher-a')).data.items[0].totalPoints, 2);
  assert.equal((await h.api('GET', '/courses/course-a/bonus-ledger?semesterId=term-old', 'teacher-a')).data.items.length, 0);
  assert.equal((await h.api('GET', '/courses/course-a/bonus-summary', 'teacher-b')).status, 403);
});
test('模拟写入流水失败时，采纳状态、奖励和业务事件一起回滚', async () => {
  await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q);
  const before = await h.database.prepare('SELECT COUNT(*) AS n FROM business_events').first('n');
  await h.database.prepare("CREATE TRIGGER fail_ledger BEFORE INSERT ON bonus_ledger BEGIN SELECT RAISE(ABORT,'simulated_failure'); END;").run();
  const r = await h.accept(q, a); assert.equal(r.status, 500);
  assert.equal((await h.api('GET', `/questions/${q}`)).data.solved, false);
  assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM bonus_ledger').first('n'), 0);
  assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM business_events').first('n'), before);
});
test('课程创建时授课关系失败，课程及事件整体回滚', async () => {
  await h.database.prepare("CREATE TRIGGER fail_teaching BEFORE INSERT ON course_teachers BEGIN SELECT RAISE(ABORT,'simulated_failure'); END;").run();
  const before = await h.database.prepare('SELECT COUNT(*) AS n FROM business_events').first('n');
  const r = await h.api('POST', '/courses', 'teacher-a', { name: '回滚课程', code: 'ROLLBACK1' });
  assert.equal(r.status, 500);
  assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM courses WHERE code='ROLLBACK1'").first('n'), 0);
  assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM business_events').first('n'), before);
});
test('删除问题撤销奖励并阻止后续回答，管理员可以跨课程审查', async () => {
  await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
  assert.equal((await h.api('GET', `/moderation/contents/${q}`, 'admin')).status, 200);
  assert.equal((await h.api('DELETE', `/contents/${q}`, 'student-a', { revision: await h.revision(q) })).status, 200);
  assert.equal((await h.api('POST', `/questions/${q}/answers`, 'student-b', { body: '删除后回复' })).status, 404);
  assert.equal(await h.database.prepare('SELECT SUM(delta_cents) AS n FROM bonus_ledger').first('n'), 0);
  assert.equal((await h.api('GET', `/contents/${q}`)).data.status, 'deleted');
});
test('数据库拒绝跨问题采纳及内容身份迁移', async () => {
  const q1 = await h.postQuestion(), q2 = await h.postQuestion(), a = await h.postAnswer(q1);
  await assert.rejects(() => h.database.prepare("UPDATE contents SET accepted_answer_id=?,accepted_by='teacher-a',accepted_at='2026-10-21T00:00:00.000Z',accepted_semester_id='term-active',acceptance_id='test-accept' WHERE id=?").bind(a, q2).run(), /invalid_acceptance/);
  await assert.rejects(() => h.database.prepare("UPDATE contents SET course_id='course-b' WHERE id=?").bind(q1).run(), /content_identity_immutable/);
});
test('无效加分小数和过大正文被拒绝，报错不返回SQL或令牌', async () => {
  const invalid = await h.api('PUT', '/courses/course-a/bonus-policy', 'teacher-a', { revision: 1, enabled: true, bonusPoints: 2.345 });
  assert.equal(invalid.status, 400);
  const large = await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '过大正文', body: '中'.repeat(50000) });
  assert.equal(large.status, 413);
  for (const r of [invalid, large]) assert.ok(!JSON.stringify(r.data).includes('local-teacher-a-token'));
});