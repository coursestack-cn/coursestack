import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, internalToken, tokenFor, doc, linkDoc } from './discussions-helpers.mjs';
let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const internalHeaders = { Authorization: `Bearer ${internalToken}` };

test('游客可浏览，写入需登录，伪造身份头无效', async () => {
    assert.equal((await h.api('GET', '/courses')).status, 200);
    const r = await h.api('POST', '/courses/course-a/questions', undefined, { title: '测试问题', body: doc('正文') }, { headers: { 'X-User-Id': 'teacher-a', 'X-Role': 'admin' } });
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
    const payload = { title: 'CSRF检查', body: doc('测试正文') };
    const cookie = { Cookie: `coursestack_session=${tokenFor('student-a')}` };
    assert.equal((await h.api('POST', '/courses/course-a/questions', undefined, payload, { headers: { ...cookie, Origin: '' } })).status, 403);
    assert.equal((await h.api('POST', '/courses/course-a/questions', undefined, payload, { headers: { ...cookie, Origin: 'http://127.0.0.1:9999' } })).status, 403);
    assert.equal((await h.api('POST', '/courses/course-a/questions', undefined, payload, { headers: { ...cookie, Origin: 'http://localhost' } })).status, 201);
    assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', payload, { headers: { Origin: 'http://127.0.0.1:9999' } })).status, 403);
});
test('教师创建课程建立当期授课关系；学生不能创建课程', async () => {
    const payload = { name: '算法设计', code: 'CS201', introduction: '算法课程' };
    assert.equal((await h.api('POST', '/courses', 'student-a', payload)).status, 403);
    const created = await h.api('POST', '/courses', 'teacher-a', payload, { key: 'create-course-01' });
    assert.equal(created.status, 201);
    const relationship = await h.database.prepare("SELECT * FROM enrollments WHERE course_id=? AND account_id IN (SELECT id FROM accounts WHERE role='teacher')").bind(created.data.id).all();
    assert.equal(relationship.results.length, 1);
    assert.equal((await h.api('PATCH', `/courses/${created.data.id}`, 'teacher-a', { name: '算法基础' })).status, 200);
    const saved = await h.api('GET', `/courses/${created.data.id}`);
    assert.equal(saved.data.introduction, '算法课程'); assert.equal('department' in saved.data, false);
    assert.deepEqual(saved.data.bonusPolicy, { pointsQuestion: 0, pointsAnswer: 0, pointsAcceptance: 0, pointsComment: 0, pointsMaterial: 0, pointsMaterialVersion: 0 });
    assert.equal((await h.api('POST', '/courses', 'teacher-a', { ...payload, department: '计算机学院' })).status, 400);
    assert.equal((await h.api('PATCH', `/courses/${created.data.id}`, 'teacher-a', { department: '计算机学院' })).status, 400);
    assert.equal((await h.api('GET', `/courses/${created.data.id}/entry`, 'teacher-a')).data.permissions.canManage, true);
    assert.equal((await h.api('GET', `/courses/${created.data.id}/entry`, 'student-a')).data.permissions.canManage, false);
    const repeated = await h.api('POST', '/courses', 'teacher-a', payload, { key: 'create-course-01' });
    assert.equal(repeated.data.id, created.data.id);
});
test('问题发布重试幂等；同一幂等键不同正文返回冲突', async () => {
    const payload = { title: '幂等测试', body: doc('不能重复发布') }, options = { key: 'same-question-request' };
    const [a, b] = await Promise.all([h.api('POST', '/courses/course-a/questions', 'student-a', payload, options), h.api('POST', '/courses/course-a/questions', 'student-a', payload, options)]);
    assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(a.data.id, b.data.id);
    const changed = await h.api('POST', '/courses/course-a/questions', 'student-a', { ...payload, body: doc('变更正文') }, options);
    assert.equal(changed.status, 409);
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM contents WHERE kind='question'").first('n'), 1);
});
test('旧版 fileVersionId 参数明确拒绝，引用只通过正文链接表达', async () => {
    for (const fileVersionId of ['version-b1', 'version-a-hidden', 'missing-version']) {
        const r = await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '版本关联', body: doc('正文'), fileVersionId });
        assert.equal(r.status, 400, JSON.stringify(r.data));
    }
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM contents WHERE kind='question'").first('n'), 0);
});
test('正文中的版本链接不受文件状态影响，编辑正文不会清空标签', async () => {
    const body = linkDoc('讲义', '/materials/material-a/versions/1');
    const q = await h.postQuestion('student-a', { body, tags: ['极限'] });
    assert.deepEqual((await h.api('GET', `/questions/${q}`)).data.body, body);
    assert.equal((await h.api('GET', '/courses/course-a/questions?fileVersionId=version-a1')).status, 400);
    await h.database.prepare("UPDATE file_versions SET status='hidden' WHERE material_id='material-a' AND version=1").run();
    const r = await h.api('GET', `/questions/${q}`); assert.equal(r.status, 200);
    assert.deepEqual(r.data.body, body); assert.equal(r.data.file, undefined);
    const edited = await h.api('PATCH', `/contents/${q}`, 'student-a', { body: doc('修改正文') });
    assert.equal(edited.status, 200); assert.equal(edited.data.fileVersionId, undefined); assert.deepEqual(edited.data.tags, ['极限']);
});
test('只能编辑本人或所管理课程内容；最后提交的正文生效', async () => {
    const q = await h.postQuestion();
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-b', { body: doc('恶意覆盖') })).status, 403);
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'teacher-b', { body: doc('越权覆盖') })).status, 403);
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-a', { body: doc('合法修改') })).status, 200);
    assert.equal((await h.api('PATCH', `/contents/${q}`, 'student-a', { body: doc('旧页面最后提交') })).status, 200);
    assert.deepEqual((await h.api('GET', `/questions/${q}`)).data.body, doc('旧页面最后提交'));
});
test('资料、问题和答案均可评论，回复只指向直接父评论', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    const targets = [{ targetKind: 'material', targetId: 'material-a' }, { targetKind: 'question', targetId: q }, { targetKind: 'answer', targetId: a }];
    const ids           = [];
    for (const target of targets) {
        const r = await h.api('POST', '/comments', 'student-b', { ...target, body: doc('**评论**与`代码`') });
        assert.equal(r.status, 201); ids.push(r.data.id);
        const items = (await h.api('GET', `/comments?targetKind=${target.targetKind}&targetId=${target.targetId}`)).data.items;
        assert.equal(items.length, 1);
        assert.equal(items[0].targetKind, target.targetKind); assert.equal(items[0].targetId, target.targetId);
        assert.equal((await h.api('GET', `/contents/${r.data.id}`)).data.targetKind, target.targetKind);
    }
    const reply = await h.api('POST', '/comments', 'teacher-a', { targetKind: 'comment', targetId: ids[0], body: doc('回复评论') });
    assert.equal(reply.status, 201);
    const thread = await h.api('GET', '/comments?targetKind=material&targetId=material-a');
    assert.equal(thread.data.total, 2);
    const dto = thread.data.items.find(c => c.id === reply.data.id);
    assert.equal(dto.targetKind, 'comment'); assert.equal(dto.targetId, ids[0]); assert.equal(dto.replyToId, undefined);
    assert.equal((await h.api('POST', '/comments', 'student-a', { targetKind: 'comment', targetId: q, body: doc('目标类型不匹配') })).status, 404);
});
test('赞踩可切换撤销且重试不累加；问题、回答和评论禁止自投', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q, 'student-a');
    const comment = await h.api('POST', '/comments', 'student-a', { targetKind: 'question', targetId: q, body: doc('问题评论') });
    for (const id of [q, a, comment.data.id]) {
        assert.equal((await h.api('PUT', `/contents/${id}/vote`, 'student-a', { value: 1 })).status, 403);
        assert.equal((await h.api('PUT', `/contents/${id}/vote`, 'student-b', { value: 1 })).status, 200);
        await h.database.prepare("UPDATE votes SET created_at=1 WHERE content_id=? AND user_id='student-b'").bind(id).run();
        for (const value of [1, 1, -1, -1, 0, 0]) {
            const vote = await h.api('PUT', `/contents/${id}/vote`, 'student-b', { value });
            assert.equal(vote.status, 200); assert.equal(vote.data.score, value); assert.equal(vote.data.myVote, value);
            const stored = await h.database.prepare("SELECT created_at FROM votes WHERE content_id=? AND user_id='student-b'").bind(id).first();
            assert.deepEqual(stored, value === 0 ? null : { created_at: 1 });
        }
        assert.equal((await h.api('PUT', `/contents/${id}/vote`, 'student-b', { value: 1 })).status, 200);
        assert.ok(await h.database.prepare("SELECT created_at FROM votes WHERE content_id=? AND user_id='student-b'").bind(id).first('created_at') > 1);
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
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'answer', targetId: a, body: doc('答案评论') });
    await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide', reason: '测试下架传播' });
    for (const id of [q, a, comment.data.id]) assert.equal((await h.api('GET', `/contents/${id}`)).status, 404);
    for (const path of ['/courses/course-a/questions', '/courses/course-a/activity', '/me/activity']) {
        const r = await h.api('GET', path, 'student-b'); assert.ok(r.data.items.every(item => ![q, a, comment.data.id].includes(item.id ?? item.contentId)), path);
    }
    const docs = await h.api('GET', '/internal/documents', undefined, undefined, { internal: true, headers: internalHeaders });
    assert.ok(docs.data.items.every((d     ) => ![q, a].includes(d.id)));
    assert.equal((await h.api('GET', `/comments?targetKind=answer&targetId=${a}`)).status, 404);
});
test('资料下架后其评论隐藏，正文链接引用资料的问题仍可阅读', async () => {
    const q = await h.postQuestion('student-a', { body: linkDoc('讲义', '/materials/material-a/versions/1') });
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'material', targetId: 'material-a', body: doc('资料评论') });
    await h.database.prepare("UPDATE contents SET status='hidden' WHERE id='material-a'").run();
    assert.equal((await h.api('GET', `/contents/${comment.data.id}`)).status, 404);
    assert.equal((await h.api('GET', `/questions/${q}`)).status, 200);
});
test('删除评论清空正文并保留关联占位与回复，删除内容不能恢复', async () => {
    const q = await h.postQuestion();
    const parent = await h.api('POST', '/comments', 'student-a', { targetKind: 'question', targetId: q, body: doc('原评论') });
    const child = await h.api('POST', '/comments', 'student-b', { targetKind: 'comment', targetId: parent.data.id, body: doc('保留回复') });
    const lonely = await h.api('POST', '/comments', 'student-a', { targetKind: 'question', targetId: q, body: doc('无回复评论') });
    // Comments created in the same second would otherwise fall back to random ID order.
    await h.database.prepare('UPDATE contents SET created_at=created_at-60 WHERE id=?').bind(parent.data.id).run();
    for (const id of [parent.data.id, lonely.data.id]) assert.equal((await h.api('DELETE', `/contents/${id}`, 'student-a', { })).status, 200);
    const list = await h.api('GET', `/comments?targetKind=question&targetId=${q}`);
    assert.deepEqual(list.data.items.map(x => [x.id, x.status ?? 'visible']), [[parent.data.id, 'deleted'], [child.data.id, 'visible']]);
    assert.equal(list.data.total, 2); assert.equal(list.data.items[0].body, null); assert.equal('author' in list.data.items[0], false);
    assert.equal(list.data.items[0].targetKind, 'question'); assert.equal(list.data.items[0].targetId, q);
    assert.equal(list.data.items[1].targetKind, 'comment'); assert.equal(list.data.items[1].targetId, parent.data.id);
    assert.equal((await h.api('GET', `/contents/${lonely.data.id}`)).data.status, 'deleted');
    assert.equal((await h.api('GET', `/contents/${parent.data.id}`)).data.body, null);
    assert.equal(await h.database.prepare('SELECT body FROM contents WHERE id=?').bind(parent.data.id).first('body'), null);
    assert.equal((await h.api('PUT', `/contents/${parent.data.id}/moderation`, 'teacher-a', { action: 'restore', reason: '尝试恢复删除' })).status, 409);
});
test('举报去重、教师审查、处理结果和下架恢复审计', async () => {
    const q = await h.postQuestion(), report = await h.api('POST', `/contents/${q}/reports`, 'student-b', { reason: '内容包含错误' });
    assert.equal(report.status, 201);
    assert.equal((await h.api('POST', `/contents/${q}/reports`, 'student-b', { reason: '重复举报内容' })).status, 409);
    assert.equal((await h.api('GET', '/moderation/reports?courseId=course-a', 'teacher-b')).status, 403);
    assert.equal((await h.api('GET', '/moderation/reports', 'student-a')).status, 403);
    assert.equal((await h.api('GET', '/moderation/reports', 'teacher-a')).data.items[0].id, report.data.id);
    await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide', reason: '已确认需要下架' });
    assert.equal((await h.api('GET', `/moderation/contents/${q}`, 'teacher-a')).data.body.content.length > 0, true);
    const resolved = await h.api('PATCH', `/moderation/reports/${report.data.id}`, 'teacher-a', { status: 'resolved', resolution: '已审查并下架' });
    assert.equal(resolved.status, 200);
    assert.equal((await h.api('GET', '/moderation/actions', 'teacher-a')).data.items[0].newStatus, 'hidden');
    assert.equal((await h.api('PATCH', `/moderation/reports/${report.data.id}`, 'teacher-a', { status: 'dismissed', resolution: '过期的处理' })).status, 409);
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
    assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', { title: ' ', body: doc('正文') })).status, 400);
    assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '问题', body: doc('正文') }, { key: 'short' })).status, 400);
    assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '问题', body: doc('正文') }, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
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
    assert.equal(material.data.kind, 'material'); assert.equal(material.data.targetId, null); assert.equal(material.data.targetKind, null);
    const edited = await h.api('PATCH', '/contents/material-a', 'student-a', { title: '新标题', body: doc('资料简介') });
    assert.equal(edited.status, 200); assert.equal(edited.data.title, '新标题');
    assert.equal((await h.api('PUT', '/contents/material-a/vote', 'student-b', { value: 1 })).status, 400);
    const q = await h.postQuestion();
    await assert.rejects(() => h.database.prepare("INSERT INTO file_versions(material_id,version,filename,uploaded_by,updated_by) VALUES (?,1,'错误.pdf','student-a','student-a')").bind(q).run(), /invalid_material/);
    await assert.rejects(() => h.database.prepare("UPDATE file_versions SET material_id=? WHERE material_id='material-a' AND version=1").bind(q).run(), /file_version_identity_immutable/);
    const answer = await h.postAnswer(q);
    const comment = await h.api('POST', '/comments', 'student-a', { targetKind: 'question', targetId: q, body: doc('父评论') });
    assert.equal(comment.status, 201);
    const insert = (kind, targetId, course = 'course-a') => h.database.prepare(`
        INSERT INTO contents(id,kind,course_id,author_id,body,target_id,updated_by,request_key,request_hash)
        VALUES ('invalid',?,?,'student-a',?,?,'student-a','invalid','fixture')`)
        .bind(kind, course, JSON.stringify(doc('正文')), targetId).run();
    for (const kind of ['answer', 'comment']) {
        await assert.rejects(() => insert(kind, q, 'course-b'), /invalid_content_target/);
        await assert.rejects(() => insert(kind, 'missing'), /invalid_content_target/);
        await assert.rejects(() => insert(kind, null), /contents_shape/);
    }
    for (const targetId of ['material-a', answer, comment.data.id]) {
        await assert.rejects(() => insert('answer', targetId), /invalid_content_target/);
    }
    const dto = (await h.api('GET', `/contents/${answer}`)).data;
    assert.equal(dto.targetKind, 'question'); assert.equal(dto.targetId, q); assert.equal(dto.questionId, undefined);
    await assert.rejects(() => h.database.prepare("UPDATE contents SET target_id='material-a' WHERE id=?").bind(answer).run(), /content_identity_immutable/);
    assert.equal((await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { action: 'hide', reason: '下架父内容' })).status, 200);
    await assert.rejects(() => insert('answer', q), /invalid_content_target/);
    await assert.rejects(() => insert('comment', answer), /invalid_content_target/);
});

test('删除问题、资料或回答清空正文与标题，其下内容不再公开但关系与文件保留', async () => {
    const q = await h.postQuestion('student-a', { tags: ['删除测试'] }), other = await h.postQuestion(), answer = await h.postAnswer(other);
    for (const [id, kind] of [[q, 'question'], ['material-a', 'material'], [answer, 'answer']]) {
        const comment = await h.api('POST', '/comments', 'student-b', { targetKind: kind, targetId: id, body: doc('下级内容') });
        assert.equal((await h.api('DELETE', `/contents/${id}`, id === answer ? 'student-b' : 'student-a', { })).status, 200);
        assert.deepEqual(await h.database.prepare('SELECT title,body,tags FROM contents WHERE id=?').bind(id).first(), { title: null, body: null, tags: null });
        for (const path of [`/contents/${id}`, `/contents/${comment.data.id}`, `/comments?targetKind=${kind}&targetId=${id}`]) {
            assert.equal((await h.api('GET', path)).status, 404, path);
        }
        assert.equal(await h.database.prepare('SELECT target_id FROM contents WHERE id=?').bind(comment.data.id).first('target_id'), id);
        assert.equal((await h.api('POST', '/comments', 'student-b', { targetKind: kind, targetId: id, body: doc('不能回复') })).status, 404);
    }
    assert.equal((await h.api('GET', `/questions/${q}`)).status, 404);
    assert.equal((await h.api('GET', `/questions/${q}/answers`)).status, 404);
    assert.equal((await h.api('GET', `/questions/${other}/answers`)).data.total, 0);
    assert.equal(await h.database.prepare("SELECT material_id FROM file_versions WHERE material_id='material-a' AND version=1").first('material_id'), 'material-a');
});

test('删除父内容不撤回其下回答已得的积分，下架才撤回', async () => {
    await h.policy({ pointsAnswer: 4 });
    const q = await h.postQuestion(), answer = await h.postAnswer(q);
    const points = () => h.database.prepare("SELECT COALESCE(SUM(delta_points),0) AS n FROM bonus_ledger WHERE student_id='student-b'").first('n');
    assert.equal(await points(), 4);
    assert.equal((await h.api('DELETE', `/contents/${q}`, 'student-a', { })).status, 200);
    assert.equal((await h.api('GET', `/contents/${answer}`)).status, 404);
    assert.equal(await points(), 4);
    const hidden = await h.postQuestion(), hiddenAnswer = await h.postAnswer(hidden);
    assert.equal(await points(), 8);
    assert.equal((await h.api('PUT', `/contents/${hidden}/moderation`, 'teacher-a', { action: 'hide', reason: '下架整个分支' })).status, 200);
    assert.equal((await h.api('GET', `/contents/${hiddenAnswer}`)).status, 404);
    assert.equal(await points(), 4);
});

test('任意层评论下架会隐藏整个分支，恢复后回复与活跃排序恢复', async () => {
    const q = await h.postQuestion(), other = await h.postQuestion();
    const comment = async (kind, id) => {
        const r = await h.api('POST', '/comments', 'student-b', { targetKind: kind, targetId: id, body: doc('评论内容') });
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
    assert.equal((await h.api('PUT', `/contents/${child}/moderation`, 'teacher-a', { action: 'hide', reason: '下架子分支' })).status, 200);
    assert.equal((await h.api('GET', `/contents/${grandchild}`)).status, 404);
    assert.equal((await h.api('GET', `/comments?targetKind=question&targetId=${q}`)).data.total, 1);
    assert.equal((await h.api('GET', '/courses/course-a/questions?sort=active')).data.items[0].id, other);
    assert.equal((await h.api('PUT', `/contents/${child}/moderation`, 'teacher-a', { action: 'restore', reason: '恢复子分支' })).status, 200);
    assert.equal((await h.api('GET', `/comments?targetKind=question&targetId=${q}`)).data.total, 3);
    assert.equal((await h.api('GET', '/courses/course-a/questions?sort=active')).data.items[0].id, q);
});