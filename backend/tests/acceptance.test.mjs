import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, setCurrentTerm } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
async function balance(student = 'student-b') {
    return (await h.database.prepare('SELECT COALESCE(SUM(delta_points),0) AS total,COUNT(*) AS entries FROM bonus_ledger WHERE student_id=?').bind(student).first());
}
test('采纳原子地解决问题并只加分一次；重复采纳不会追加事件或流水', async () => {
    await h.policy({ acceptancePoints: 50 }); const q = await h.postQuestion(), a = await h.postAnswer(q);
    const r = await h.accept(q, a); assert.equal(r.status, 200); assert.equal(r.data.solved, true); assert.equal(r.data.acceptedAnswerId, a); assert.equal('award' in r.data, false);
    assert.deepEqual(await balance(), { total: 50, entries: 1 });
    const eventCount = await h.database.prepare('SELECT COUNT(*) AS n FROM business_events').first('n');
    const repeat = await h.api('PUT', `/questions/${q}/acceptance`, 'teacher-a', { answerId: a });
    assert.equal(repeat.status, 200); assert.equal(repeat.data.changed, false);
    assert.deepEqual(await balance(), { total: 50, entries: 1 });
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM business_events').first('n'), eventCount);
});
test('更换采纳冲销旧学生并奖励新学生；取消后两人余额均为零', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q), b = await h.postAnswer(q, 'student-a');
    await h.accept(q, a); const changed = await h.accept(q, b); assert.equal(changed.status, 200);
    assert.equal((await balance()).total, 0); assert.equal((await balance('student-a')).total, 50);
    const cancel = await h.accept(q, null); assert.equal(cancel.data.solved, false);
    assert.equal((await balance('student-a')).total, 0);
});
test('提问者和其他课程/历年教师不能采纳；其他问题的答案不能被采纳', async () => {
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    assert.equal((await h.accept(q, a, 'student-a')).status, 403);
    assert.equal((await h.accept(q, a, 'teacher-b')).status, 403);
    const q2 = await h.postQuestion();
    assert.equal((await h.accept(q2, a)).status, 400);
    assert.equal((await balance()).entries, 0);
});
test('教师和未正式修读者的回答可以采纳，但不加分', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q, 'teacher-a');
    assert.equal((await h.accept(q, a)).status, 200);
    const outsider = await h.postAnswer(q, 'visitor'); assert.equal((await h.accept(q, outsider)).status, 200); assert.equal((await balance('teacher-a')).entries, 0);
    assert.equal((await balance('visitor')).entries, 0);
});
test('删除被采纳答案自动取消采纳并冲销加分，保留删除占位', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    const deleted = await h.api('DELETE', `/contents/${a}`, 'student-b', { revision: await h.revision(a) });
    assert.equal(deleted.status, 200); assert.equal((await h.api('GET', `/questions/${q}`)).data.solved, false);
    assert.equal((await balance()).total, 0);
    const tombstone = await h.api('GET', `/contents/${a}`); assert.equal(tombstone.data.body, null); assert.equal(tombstone.data.status, 'deleted');
    assert.equal((await h.api('GET', `/questions/${q}/answers`)).data.items.length, 0);
});
test('下架答案撤回分数；恢复可见性恢复采纳和原奖励', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    const hide = await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '内容需要修正' });
    assert.equal(hide.status, 200); assert.equal((await balance()).total, 0);
    assert.equal((await h.api('GET', `/contents/${a}`)).status, 404);
    const restored = await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { revision: 2, action: 'restore', reason: '已经核实内容' });
    assert.equal(restored.status, 200); assert.equal((await h.api('GET', `/questions/${q}`)).data.acceptedAnswerId, a);
    assert.equal((await balance()).total, 50);
});
test('下架或删除问题同时撤回采纳和加分', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    const hide = await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { revision: await h.revision(q), action: 'hide', reason: '问题需要审查' });
    assert.equal(hide.status, 200); assert.equal((await balance()).total, 0);
    assert.equal((await h.api('GET', `/contents/${a}`)).status, 404);
});
test('取消后重新采纳恢复原奖励，课程配置变化不重算历史奖励', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    await h.policy({ acceptancePoints: 90 }); assert.equal((await balance()).total, 50);
    await h.accept(q, null); assert.equal((await balance()).total, 0);
    await h.accept(q, a); assert.deepEqual(await balance(), { total: 50, entries: 3 });
    const relation = await h.database.prepare('SELECT question_id,answer_id,operator_id FROM acceptances WHERE question_id=?').bind(q).first();
    assert.deepEqual(relation, { question_id: q, answer_id: a, operator_id: 'teacher-a' });
    assert.equal(await h.revision(q), 1);
});
test('并发采纳保持一问一个答案和一笔有效奖励；同一答案并发重试无副作用', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q), b = await h.postAnswer(q, 'student-a');
    const results = await Promise.all([a, b].map(answerId => h.api('PUT', `/questions/${q}/acceptance`, 'teacher-a', { answerId })));
    assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
    assert.equal(await h.database.prepare('SELECT count(*) AS n FROM acceptances WHERE question_id=?').bind(q).first('n'), 1);
    assert.equal(await h.database.prepare('SELECT SUM(delta_points) AS n FROM bonus_ledger').first('n'), 50);
    const current = (await h.api('GET', `/questions/${q}`)).data.acceptedAnswerId;
    const count = await h.database.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n');
    const repeated = await Promise.all([1, 2].map(() => h.accept(q, current)));
    assert.ok(repeated.every(r => r.status === 200 && !r.data.changed));
    assert.equal(await h.database.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n'), count);
});
test('学期归档后历史教师失去权限；管理员撤销时冲销原学期的奖励', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    await setCurrentTerm(h.database, null);
    await h.database.prepare("INSERT INTO terms(id,name) VALUES ('term-next','2027春')").run();
    await setCurrentTerm(h.database, 'term-next');
    assert.equal((await h.accept(q, null)).status, 403);
    assert.equal((await h.accept(q, null, 'admin')).status, 200); assert.equal((await balance()).total, 0);
    const terms = await h.database.prepare('SELECT DISTINCT term_id FROM bonus_ledger').all();
    assert.deepEqual(terms.results, [{ term_id: 'term-active' }]);
});
test('加分流水在数据库层不可修改或删除', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    await assert.rejects(() => h.database.prepare('UPDATE bonus_ledger SET delta_points=999').run(), /immutable_ledger/);
    await assert.rejects(() => h.database.prepare('DELETE FROM bonus_ledger').run(), /immutable_ledger/);
});

test('下一学期重新采纳仍恢复原学期奖励，事件有独立标识且没有修改内容版本', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q);
    await h.accept(q, a); await h.accept(q, null);
    await h.database.prepare("INSERT INTO terms(id,name) VALUES ('term-next','2027春')").run();
    await setCurrentTerm(h.database, 'term-next');
    assert.equal((await h.accept(q, a, 'admin')).status, 200);
    assert.equal((await balance()).total, 50);
    assert.deepEqual((await h.database.prepare('SELECT DISTINCT term_id FROM bonus_ledger').all()).results, [{ term_id: 'term-active' }]);
    const events = (await h.database.prepare("SELECT event_id,payload FROM business_events WHERE type='question.acceptance_changed'").all()).results;
    assert.equal(events.length, 3); assert.equal(new Set(events.map(e => e.event_id)).size, 3);
    assert.equal(await h.revision(q), 1);
    const payload = JSON.parse(events.at(-1).payload);
    assert.equal(payload.answerAuthorId, 'student-b');
});