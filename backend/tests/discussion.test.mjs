import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, internalToken, tokenFor } from './discussions-helpers.mjs';
let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const internalHeaders = { Authorization: `Bearer ${internalToken}` };

test('游客可浏览，写入需登录，伪造身份头无效', async () => {
    assert.equal((await h.api('GET', '/courses')).status, 200);
    const r = await h.api('POST', '/courses/course-a/questions', undefined, { title: '测试问题', body: '正文' }, { headers: { 'X-User-Id': 'teacher-a', 'X-Role': 'admin' } });
    assert.equal(r.status, 401); assert.equal(r.data.error.code, 'AUTH_REQUIRED');
    assert.ok(r.headers.get('x-request-id'));
});
test('过期会话和停用账号不可操作', async () => {
    await h.database.prepare("UPDATE sessions SET expires_at=1 WHERE account_id='student-a'").run();
    assert.equal((await h.api('GET', '/me/activity', 'student-a')).status, 401);
    await h.database.prepare("UPDATE accounts SET status='disabled' WHERE id='student-b'").run();
    assert.equal((await h.api('GET', '/me/activity', 'student-b')).status, 401);
});
test('Cookie 写入要求同源 Origin；跨站请求被拒绝', async () => {
    const payload = { title: 'CSRF检查', body: '测试正文' };
    const cookie = { Cookie: `coursestack_session=${tokenFor('student-a')}` };
    assert.equal((await h.api('POST', '/courses/course-a/questions', undefined, payload, { headers: { ...cookie, Origin: '' } })).status, 403);
    assert.equal((await h.api('POST', '/courses/course-a/questions', undefined, payload, { headers: { ...cookie, Origin: 'http://127.0.0.1:9999' } })).status, 403);
    assert.equal((await h.api('POST', '/courses/course-a/questions', undefined, payload, { headers: { ...cookie, Origin: 'http://localhost' } })).status, 201);
    assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', payload, { headers: { Origin: 'http://127.0.0.1:9999' } })).status, 403);
});
test('教师创建课程建立当期授课关系；学生不能创建课程', async () => {
    const payload = { name: '算法设计', code: 'CS201', introduction: '算法课程', department: '计算机学院' };
    assert.equal((await h.api('POST', '/courses', 'student-a', payload)).status, 403);
    const created = await h.api('POST', '/courses', 'teacher-a', payload, { key: 'create-course-01' });
    assert.equal(created.status, 201);
    const relationship = await h.database.prepare("SELECT * FROM enrollments WHERE course_id=? AND account_id IN (SELECT id FROM accounts WHERE role='teacher')").bind(created.data.id).all();
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
test('旧版 fileVersionId 参数明确拒绝，引用只通过正文链接表达', async () => {
    for (const fileVersionId of ['version-b1', 'version-a-hidden', 'missing-version']) {
        const r = await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '版本关联', body: '正文', fileVersionId });
        assert.equal(r.status, 400, JSON.stringify(r.data));
    }
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM contents WHERE kind='question'").first('n'), 0);
});
test('正文中的版本链接不受文件状态影响，编辑正文不会清空标签', async () => {
    const body = '[讲义](/materials/material-a/versions/version-a1)';
    const q = await h.postQuestion('student-a', { body, tags: ['极限'] });
    assert.equal((await h.api('GET', `/questions/${q}`)).data.body, body);
    assert.equal((await h.api('GET', '/courses/course-a/questions?fileVersionId=version-a1')).status, 400);
    await h.database.prepare("UPDATE file_versions SET status='hidden' WHERE id='version-a1'").run();
    const r = await h.api('GET', `/questions/${q}`); assert.equal(r.status, 200);
    assert.equal(r.data.body, body); assert.equal(r.data.file, undefined);
    const edited = await h.api('PATCH', `/contents/${q}`, 'student-a', { revision: 1, body: '修改正文' });
    assert.equal(edited.status, 200); assert.equal(edited.data.fileVersionId, undefined); assert.deepEqual(edited.data.tags, ['极限']);
});
test('只能编辑本人或所管理课程内容；旧 revision 不能覆盖修改', async () => {
    const q = await h.postQuestion();
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-b', { revision: 1, body: '恶意覆盖' })).status, 403);
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'teacher-b', { revision: 1, body: '越权覆盖' })).status, 403);
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-a', { revision: 1, body: '合法修改' })).status, 200);
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-a', { revision: 1, body: '过期修改' })).status, 409);
    assert.equal((await h.api('GET', `/questions/${q}`)).data.body, '合法修改');
});
test('资料、问题和答案均可评论，回复只指向直接父评论', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    const targets = [{ targetKind: 'material', targetId: 'material-a' }, { targetKind: 'question', targetId: q }, { targetKind: 'answer', targetId: a }];
    const ids           = [];
    for (const target of targets) {
        const r = await h.api('POST', '/comments', 'student-b', { ...target, body: '**评论**与`代码`' });
        assert.equal(r.status, 201); ids.push(r.data.id);
        assert.equal((await h.api('GET', `/comments?targetKind=${target.targetKind}&targetId=${target.targetId}`)).data.items.length, 1);
    }
    const reply = await h.api('POST', '/comments', 'teacher-a', { targetKind: 'comment', targetId: ids[0], body: '回复评论' });
    assert.equal(reply.status, 201);
    const thread = await h.api('GET', '/comments?targetKind=material&targetId=material-a');
    assert.equal(thread.data.total, 2);
    const dto = thread.data.items.find(c => c.id === reply.data.id);
    assert.equal(dto.targetKind, 'comment'); assert.equal(dto.targetId, ids[0]); assert.equal(dto.replyToId, undefined);
    assert.equal((await h.api('POST', '/comments', 'student-a', { targetKind: 'comment', targetId: q, body: '目标类型不匹配' })).status, 404);
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
        const r = await h.api('GET', path, 'student-b'); assert.ok(r.data.items.every(item => ![q, a, comment.data.id].includes(item.id ?? item.contentId)), path);
    }
    const docs = await h.api('GET', '/internal/documents', undefined, undefined, { internal: true, headers: internalHeaders });
    assert.ok(docs.data.items.every((d     ) => ![q, a].includes(d.id)));
    assert.equal((await h.api('GET', `/comments?targetKind=answer&targetId=${a}`)).status, 404);
});
test('资料下架后其评论隐藏，正文链接引用资料的问题仍可阅读', async () => {
    const q = await h.postQuestion('student-a', { body: '[讲义](/materials/material-a/versions/version-a1)' });
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'material', targetId: 'material-a', body: '资料评论' });
    await h.database.prepare("UPDATE contents SET status='hidden' WHERE id='material-a'").run();
    assert.equal((await h.api('GET', `/contents/${comment.data.id}`)).status, 404);
    assert.equal((await h.api('GET', `/questions/${q}`)).status, 200);
});
test('删除评论清空正文并保留关联占位与回复，删除内容不能恢复', async () => {
    const q = await h.postQuestion();
    const parent = await h.api('POST', '/comments', 'student-a', { targetKind: 'question', targetId: q, body: '原评论' });
    const child = await h.api('POST', '/comments', 'student-b', { targetKind: 'comment', targetId: parent.data.id, body: '保留回复' });
    assert.equal((await h.api('DELETE', `/contents/${parent.data.id}`, 'student-a', { revision: 1 })).status, 200);
    const list = await h.api('GET', `/comments?targetKind=question&targetId=${q}`);
    assert.deepEqual(list.data.items.map((x     ) => x.id), [child.data.id]);
    assert.equal((await h.api('GET', `/contents/${parent.data.id}`)).data.body, null);
    assert.equal(await h.database.prepare('SELECT body FROM contents WHERE id=?').bind(parent.data.id).first('body'), '');
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
        const result = await h.api('GET', path);
        assert.equal(result.status, 200);
        const text = JSON.stringify(result.data);
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
    assert.equal(p1.data.total, 2); assert.equal(p2.data.total, 2); assert.notEqual(p1.data.items[0].id, p2.data.items[0].id);
});
test('带 SQL 字符的课程查询和标签保持参数化', async () => {
    await h.postQuestion('student-a', { tags: ["' OR 1=1 --"] });
    assert.equal((await h.api('GET', '/courses?q=' + encodeURIComponent("' OR 1=1 --"))).data.items.length, 0);
    assert.equal((await h.api('GET', '/courses/course-a/questions?tag=' + encodeURIComponent("' OR 1=1 --"))).data.items.length, 1);
    assert.equal((await h.api('GET', '/courses')).data.items.length, 2);
});

test('资料统一为内容，文件外键拒绝非资料，直接父级拒绝跨课程和类型错误', async () => {
    const material = await h.api('GET', '/contents/material-a');
    assert.equal(material.data.kind, 'material'); assert.equal(material.data.targetId, null);
    const edited = await h.api('PATCH', '/contents/material-a', 'student-a', { revision: 1, title: '新标题', body: '资料简介' });
    assert.equal(edited.status, 200); assert.equal(edited.data.title, '新标题');
    assert.equal((await h.api('PUT', '/contents/material-a/vote', 'student-b', { value: 1 })).status, 400);
    const q = await h.postQuestion();
    await assert.rejects(() => h.database.prepare("INSERT INTO file_versions VALUES ('invalid',?,'错误.pdf',1,'visible')").bind(q).run(), /invalid_material/);
    await assert.rejects(() => h.database.prepare("UPDATE file_versions SET material_id=? WHERE id='version-a1'").bind(q).run(), /invalid_material/);
    for (const [course, kind, id] of [['course-b', 'question', q], ['course-a', 'answer', q], ['course-a', 'question', 'missing']]) {
        await assert.rejects(() => h.database.prepare("INSERT INTO contents(id,kind,course_id,author_id,body,target_kind,target_id,updated_by) VALUES ('invalid','comment',?,'student-a','正文',?,?,'student-a')").bind(course, kind, id).run(), /invalid_content_target/);
    }
    await assert.rejects(() => h.database.prepare("INSERT INTO contents(id,kind,course_id,author_id,body,updated_by) VALUES ('invalid','answer','course-a','student-a','正文','student-a')").run(), /contents_shape/);
    const answer = await h.postAnswer(q);
    const dto = (await h.api('GET', `/contents/${answer}`)).data;
    assert.equal(dto.targetKind, 'question'); assert.equal(dto.targetId, q); assert.equal(dto.questionId, undefined);
    await assert.rejects(() => h.database.prepare("UPDATE contents SET target_kind='material',target_id='material-a' WHERE id=?").bind(answer).run(), /content_identity_immutable/);
});

test('删除问题或资料清空正文与标题，保留回答、评论及文件关系', async () => {
    const q = await h.postQuestion('student-a', { tags: ['删除测试'] }), answer = await h.postAnswer(q);
    for (const id of [q, 'material-a']) {
        const kind = id === q ? 'question' : 'material';
        const comment = await h.api('POST', '/comments', 'student-b', { targetKind: kind, targetId: id, body: '保留内容' });
        assert.equal((await h.api('DELETE', `/contents/${id}`, 'student-a', { revision: 1 })).status, 200);
        assert.deepEqual(await h.database.prepare('SELECT title,body,tags FROM contents WHERE id=?').bind(id).first(), { title: '', body: '', tags: null });
        const list = await h.api('GET', `/comments?targetKind=${kind}&targetId=${id}`);
        assert.equal(list.status, 200); assert.equal(list.data.items[0].id, comment.data.id);
        assert.equal((await h.api('POST', '/comments', 'student-b', { targetKind: kind, targetId: id, body: '不能回复占位' })).status, 404);
    }
    assert.equal((await h.api('GET', `/questions/${q}`)).data.status, 'deleted');
    assert.equal((await h.api('GET', `/questions/${q}/answers`)).data.items[0].id, answer);
    assert.equal(await h.database.prepare("SELECT material_id FROM file_versions WHERE id='version-a1'").first('material_id'), 'material-a');
});

test('任意层评论下架会隐藏整个分支，恢复后回复与活跃排序恢复', async () => {
    const q = await h.postQuestion(), other = await h.postQuestion();
    const comment = async (kind, id) => {
        const r = await h.api('POST', '/comments', 'student-b', { targetKind: kind, targetId: id, body: '评论内容' });
        assert.equal(r.status, 201); return r.data.id;
    };
    const parent = await comment('question', q), child = await comment('comment', parent), grandchild = await comment('comment', child);
    await h.database.batch([
        h.database.prepare('UPDATE contents SET updated_at=100 WHERE id IN (?,?,?)').bind(q, parent, child),
        h.database.prepare('UPDATE contents SET updated_at=200 WHERE id=?').bind(other),
        h.database.prepare('UPDATE contents SET updated_at=300 WHERE id=?').bind(grandchild),
    ]);
    assert.equal((await h.api('GET', '/courses/course-a/questions?sort=active')).data.items[0].id, q);
    assert.equal((await h.api('GET', `/comments?targetKind=question&targetId=${q}`)).data.total, 3);
    assert.equal((await h.api('PUT', `/contents/${child}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '下架子分支' })).status, 200);
    assert.equal((await h.api('GET', `/contents/${grandchild}`)).status, 404);
    assert.equal((await h.api('GET', `/comments?targetKind=question&targetId=${q}`)).data.total, 1);
    assert.equal((await h.api('GET', '/courses/course-a/questions?sort=active')).data.items[0].id, other);
    assert.equal((await h.api('PUT', `/contents/${child}/moderation`, 'teacher-a', { revision: 2, action: 'restore', reason: '恢复子分支' })).status, 200);
    assert.equal((await h.api('GET', `/comments?targetKind=question&targetId=${q}`)).data.total, 3);
    assert.equal((await h.api('GET', '/courses/course-a/questions?sort=active')).data.items[0].id, q);
});