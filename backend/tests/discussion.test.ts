import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, internalToken, type Harness } from './harness';
let h: Harness;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const internalHeaders = { Authorization: `Bearer ${internalToken}` };

test('游客可浏览，写入需登录，伪造身份头无效', async () => {
  assert.equal((await h.api('GET', '/courses')).status, 200);
  const r = await h.api('POST', '/courses/course-a/questions', undefined, { title: '测试问题', body: '正文' }, { headers: { 'X-User-Id': 'teacher-a', 'X-Role': 'admin' } });
  assert.equal(r.status, 401); assert.equal(r.data.error.code, 'UNAUTHENTICATED');
  assert.ok(r.headers.get('x-request-id'));
});
test('过期会话和停用账号不可操作', async () => {
  await h.database.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id='student-a'").run();
  assert.equal((await h.api('GET', '/me/activity', 'student-a')).status, 401);
  await h.database.prepare("UPDATE users SET active=0 WHERE id='student-b'").run();
  assert.equal((await h.api('GET', '/me/activity', 'student-b')).status, 401);
});
test('Cookie 写入校验可信 Origin；跨站 Bearer 写入也被拒绝', async () => {
  const payload = { title: 'CSRF检查', body: '测试正文' };
  const cookie = { Cookie: 'coursestack_session=local-student-a-token-2026' };
  assert.equal((await h.api('POST', '/courses/course-a/questions', undefined, payload, { headers: cookie })).status, 403);
  assert.equal((await h.api('POST', '/courses/course-a/questions', undefined, payload, { headers: { ...cookie, Origin: 'http://127.0.0.1:9999' } })).status, 403);
  assert.equal((await h.api('POST', '/courses/course-a/questions', undefined, payload, { headers: { ...cookie, Origin: 'http://localhost:5173' } })).status, 201);
  assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', payload, { headers: { Origin: 'http://127.0.0.1:9999' } })).status, 403);
});
test('教师创建课程建立当期授课关系；学生不能创建课程', async () => {
  const payload = { name: '算法设计', code: 'CS201', introduction: '算法课程', department: '计算机学院' };
  assert.equal((await h.api('POST', '/courses', 'student-a', payload)).status, 403);
  const created = await h.api('POST', '/courses', 'teacher-a', payload, { key: 'create-course-01' });
  assert.equal(created.status, 201);
  const relationship = await h.database.prepare('SELECT * FROM course_teachers WHERE course_id=?').bind(created.data.id).all();
  assert.equal(relationship.results.length, 1);
  assert.equal((await h.api('PATCH', `/courses/${created.data.id}`, 'teacher-a', { revision: 1, name: '算法基础' })).status, 200);
  const saved = await h.api('GET', `/courses/${created.data.id}`);
  assert.equal(saved.data.introduction, '算法课程'); assert.equal(saved.data.department, '计算机学院');
  assert.equal((await h.api('GET', `/courses/${created.data.id}/entry`, 'teacher-a')).data.permissions.canManage, true);
  assert.equal((await h.api('GET', `/courses/${created.data.id}/entry`, 'student-a')).data.permissions.canManage, false);
  const repeated = await h.api('POST', '/courses', 'teacher-a', payload, { key: 'create-course-01' });
  assert.equal(repeated.data.id, created.data.id);
});
test('问题发布重试幂等；同一幂等键不同正文返回冲突', async () => {
  const payload = { title: '幂等测试', body: '不能重复发布' }, options = { key: 'same-question-request' };
  const [a, b] = await Promise.all([h.api('POST', '/courses/course-a/questions', 'student-a', payload, options), h.api('POST', '/courses/course-a/questions', 'student-a', payload, options)]);
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(a.data.id, b.data.id);
  const changed = await h.api('POST', '/courses/course-a/questions', 'student-a', { ...payload, body: '变更正文' }, options);
  assert.equal(changed.status, 409);
  assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM contents WHERE kind='question'").first('n'), 1);
  assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM business_events WHERE type='question.created'").first('n'), 1);
});
test('跨课程、下架及不存在的文件版本不能关联', async () => {
  for (const fileVersionId of ['version-b1', 'version-a-hidden', 'missing-version']) {
    const r = await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '版本关联', body: '正文', fileVersionId });
    assert.equal(r.status, 409, JSON.stringify(r.data));
  }
  assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM contents').first('n'), 0);
});
test('固定版本关联不跟随新版本；文件下架后讨论可读且不暴露文件信息', async () => {
  const q = await h.postQuestion('student-a', { fileVersionId: 'version-a1', tags: ['极限'] });
  assert.equal((await h.api('GET', `/questions/${q}`)).data.file.version, 1);
  await h.database.prepare("UPDATE file_versions SET status='hidden' WHERE id='version-a1'").run();
  const r = await h.api('GET', `/questions/${q}`); assert.equal(r.status, 200);
  assert.deepEqual(r.data.file, { id: 'version-a1', available: false });
  const edited = await h.api('PATCH', `/contents/${q}`, 'student-a', { revision: 1, body: '修改正文但保留原关联' });
  assert.equal(edited.status, 200); assert.equal(edited.data.fileVersionId, 'version-a1'); assert.deepEqual(edited.data.tags, ['极限']);
});
test('只能编辑本人或所管理课程内容；旧 revision 不能覆盖修改', async () => {
  const q = await h.postQuestion();
  assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-b', { revision: 1, body: '恶意覆盖' })).status, 403);
  assert.equal((await h.api('PATCH', `/contents/${q}`, 'teacher-b', { revision: 1, body: '越权覆盖' })).status, 403);
  assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-a', { revision: 1, body: '合法修改' })).status, 200);
  assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-a', { revision: 1, body: '过期修改' })).status, 409);
  assert.equal((await h.api('GET', `/questions/${q}`)).data.body, '合法修改');
});
test('资料、问题和答案均可评论，回复必须属于相同目标', async () => {
  const q = await h.postQuestion(), a = await h.postAnswer(q);
  const targets = [{ targetKind: 'material', targetId: 'material-a' }, { targetKind: 'question', targetId: q }, { targetKind: 'answer', targetId: a }];
  const ids: string[] = [];
  for (const target of targets) {
    const r = await h.api('POST', '/comments', 'student-b', { ...target, body: '**评论**与`代码`' });
    assert.equal(r.status, 201); ids.push(r.data.id);
    assert.equal((await h.api('GET', `/comments?targetKind=${target.targetKind}&targetId=${target.targetId}`)).data.items.length, 1);
  }
  const reply = await h.api('POST', '/comments', 'teacher-a', { ...targets[0], body: '回复评论', replyToId: ids[0] });
  assert.equal(reply.status, 201);
  assert.equal((await h.api('POST', '/comments', 'student-a', { ...targets[1], body: '跨目标回复', replyToId: ids[0] })).status, 409);
});
test('赞踩可切换撤销且重试不累加；问题、回答和评论禁止自投', async () => {
  const q = await h.postQuestion(), a = await h.postAnswer(q, 'student-a');
  const comment = await h.api('POST', '/comments', 'student-a', { targetKind: 'question', targetId: q, body: '问题评论' });
  for (const id of [q, a, comment.data.id]) {
    assert.equal((await h.api('PUT', `/contents/${id}/vote`, 'student-a', { value: 1 })).status, 403);
    for (const value of [1, 1, -1, -1, 0, 0]) {
      const vote = await h.api('PUT', `/contents/${id}/vote`, 'student-b', { value });
      assert.equal(vote.status, 200); assert.equal(vote.data.score, value); assert.equal(vote.data.myVote, value);
    }
  }
});
test('教师身份不自动置顶；净赞数排序，采纳后置顶', async () => {
  const q = await h.postQuestion(), teacher = await h.postAnswer(q, 'teacher-a'), student = await h.postAnswer(q);
  await h.api('PUT', `/contents/${student}/vote`, 'student-a', { value: 1 });
  const sorted = await h.api('GET', `/questions/${q}/answers`);
  assert.equal(sorted.data.items[0].id, student); assert.equal(sorted.data.items[1].author.isCourseTeacher, true);
  await h.accept(q, teacher);
  const accepted = await h.api('GET', `/questions/${q}/answers`);
  assert.equal(accepted.data.items[0].id, teacher); assert.equal(accepted.data.items[0].isAccepted, true);
  assert.equal((await h.api('GET', '/courses/course-a/questions?state=solved')).data.items.length, 1);
  assert.equal((await h.api('GET', '/courses/course-a/questions?state=unresolved')).data.items.length, 0);
});
test('问题下架后，列表、答案、评论、个人空间、动态和搜索文档同步隐藏', async () => {
  const q = await h.postQuestion(), a = await h.postAnswer(q);
  const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'answer', targetId: a, body: '答案评论' });
  await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '测试下架传播' });
  for (const id of [q, a, comment.data.id]) assert.equal((await h.api('GET', `/contents/${id}`)).status, 404);
  for (const path of ['/courses/course-a/questions', '/courses/course-a/activity', '/me/activity']) {
    const r = await h.api('GET', path, 'student-b'); assert.equal(r.data.items.length, 0, path);
  }
  const docs = await h.api('GET', '/internal/documents', undefined, undefined, { internal: true, headers: internalHeaders });
  assert.ok(docs.data.items.every((d: any) => ![q, a].includes(d.id)));
  assert.equal((await h.api('GET', `/comments?targetKind=answer&targetId=${a}`)).status, 404);
});
test('资料下架后其评论隐藏，但关联该资料版本的问题仍可阅读', async () => {
  const q = await h.postQuestion('student-a', { fileVersionId: 'version-a1' });
  const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'material', targetId: 'material-a', body: '资料评论' });
  await h.database.prepare("UPDATE materials SET status='hidden' WHERE id='material-a'").run();
  assert.equal((await h.api('GET', `/contents/${comment.data.id}`)).status, 404);
  assert.equal((await h.api('GET', `/questions/${q}`)).status, 200);
});
test('删除评论保留占位及同目标下的回复，删除内容不能恢复', async () => {
  const q = await h.postQuestion();
  const parent = await h.api('POST', '/comments', 'student-a', { targetKind: 'question', targetId: q, body: '原评论' });
  const child = await h.api('POST', '/comments', 'student-b', { targetKind: 'question', targetId: q, body: '保留回复', replyToId: parent.data.id });
  assert.equal((await h.api('DELETE', `/contents/${parent.data.id}`, 'student-a', { revision: 1 })).status, 200);
  const list = await h.api('GET', `/comments?targetKind=question&targetId=${q}`);
  assert.deepEqual(list.data.items.map((x: any) => x.id), [child.data.id]);
  assert.equal((await h.api('GET', `/contents/${parent.data.id}`)).data.body, null);
  assert.equal((await h.api('PUT', `/contents/${parent.data.id}/moderation`, 'teacher-a', { revision: 2, action: 'restore', reason: '尝试恢复删除' })).status, 409);
});
test('举报去重、教师审查、处理结果和下架恢复审计', async () => {
  const q = await h.postQuestion(), report = await h.api('POST', `/contents/${q}/reports`, 'student-b', { reason: '内容包含错误' });
  assert.equal(report.status, 201);
  assert.equal((await h.api('POST', `/contents/${q}/reports`, 'student-b', { reason: '重复举报内容' })).status, 409);
  assert.equal((await h.api('GET', '/moderation/reports?courseId=course-a', 'teacher-b')).status, 403);
  assert.equal((await h.api('GET', '/moderation/reports', 'student-a')).status, 403);
  assert.equal((await h.api('GET', '/moderation/reports', 'teacher-a')).data.items[0].id, report.data.id);
  await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '已确认需要下架' });
  assert.equal((await h.api('GET', `/moderation/contents/${q}`, 'teacher-a')).data.body.length > 0, true);
  const resolved = await h.api('PATCH', `/moderation/reports/${report.data.id}`, 'teacher-a', { revision: 1, status: 'resolved', resolution: '已审查并下架' });
  assert.equal(resolved.status, 200);
  assert.equal((await h.api('GET', '/moderation/actions', 'teacher-a')).data.items[0].newStatus, 'hidden');
  assert.equal((await h.api('PATCH', `/moderation/reports/${report.data.id}`, 'teacher-a', { revision: 1, status: 'dismissed', resolution: '过期的处理' })).status, 409);
});
test('所有公开 DTO 不包含会话、学籍或内部幂等信息', async () => {
  const q = await h.postQuestion(), a = await h.postAnswer(q);
  for (const path of ['/courses/course-a', `/questions/${q}`, `/contents/${a}`, `/questions/${q}/answers`]) {
    const text = JSON.stringify((await h.api('GET', path)).data);
    for (const field of ['request_hash', 'request_key', 'token_hash', 'email', 'student_number', 'acceptance_id', 'award_cents']) assert.ok(!text.includes(field), field);
  }
  assert.equal((await h.api('GET', '/courses/course-a/bonus-ledger', 'student-b')).status, 403);
});
test('分页、筛选、输入长度、幂等键和 JSON 类型均经过验证', async () => {
  for (const suffix of ['?page=0', '?pageSize=51', '?page=1.5', '?page=NaN']) assert.equal((await h.api('GET', '/courses' + suffix)).status, 400);
  assert.equal((await h.api('GET', '/courses/course-a/questions?sort=random')).status, 400);
  assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', { title: ' ', body: '正文' })).status, 400);
  assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '问题', body: '正文' }, { key: 'short' })).status, 400);
  assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '问题', body: '正文' }, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  await h.postQuestion(); await h.postQuestion();
  const p1 = await h.api('GET', '/courses/course-a/questions?pageSize=1');
  const p2 = await h.api('GET', '/courses/course-a/questions?pageSize=1&page=2');
  assert.equal(p1.data.hasMore, true); assert.equal(p2.data.hasMore, false); assert.notEqual(p1.data.items[0].id, p2.data.items[0].id);
});
test('带 SQL 字符的课程查询和标签保持参数化', async () => {
  await h.postQuestion('student-a', { tags: ["' OR 1=1 --"] });
  assert.equal((await h.api('GET', '/courses?q=' + encodeURIComponent("' OR 1=1 --"))).data.items.length, 0);
  assert.equal((await h.api('GET', '/courses/course-a/questions?tag=' + encodeURIComponent("' OR 1=1 --"))).data.items.length, 1);
  assert.equal((await h.api('GET', '/courses')).data.items.length, 2);
});