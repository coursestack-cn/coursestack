import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, setCurrentTerm } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
async function balance(student = 'student-b') {
    return (await h.database.prepare('SELECT COALESCE(SUM(delta_cents),0) AS total,COUNT(*) AS entries FROM bonus_ledger WHERE student_id=?').bind(student).first());
}
test('采纳原子地解决问题并只加分一次；重复采纳不会追加事件或流水', async () => {
    await h.policy(true, 2.5); const q = await h.postQuestion(), a = await h.postAnswer(q);
    const r = await h.accept(q, a); assert.equal(r.status, 200); assert.equal(r.data.solved, true); assert.equal(r.data.award.points, 2.5);
    assert.deepEqual(await balance(), { total: 250, entries: 1 });
    const eventCount = await h.database.prepare('SELECT COUNT(*) AS n FROM business_events').first('n');
    const repeat = await h.api('PUT', `/questions/${q}/acceptance`, 'teacher-a', { answerId: a, revision: 1 });
    assert.equal(repeat.status, 200); assert.equal(repeat.data.changed, false);
    assert.deepEqual(await balance(), { total: 250, entries: 1 });
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM business_events').first('n'), eventCount);
});
test('更换采纳冲销旧学生并奖励新学生；取消后两人余额均为零', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q), b = await h.postAnswer(q, 'student-a');
    await h.accept(q, a); const changed = await h.accept(q, b); assert.equal(changed.status, 200);
    assert.equal((await balance()).total, 0); assert.equal((await balance('student-a')).total, 200);
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
    assert.equal((await h.accept(q, a)).data.award.points, 0);
    const outsider = await h.postAnswer(q, 'visitor'); assert.equal((await h.accept(q, outsider)).data.award.points, 0);
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
test('下架答案冲销分数；恢复可见性不会自动恢复采纳或奖励', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    const hide = await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '内容需要修正' });
    assert.equal(hide.status, 200); assert.equal((await balance()).total, 0);
    assert.equal((await h.api('GET', `/contents/${a}`)).status, 404);
    const restored = await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { revision: 2, action: 'restore', reason: '已经核实内容' });
    assert.equal(restored.status, 200); assert.equal((await h.api('GET', `/questions/${q}`)).data.acceptedAnswerId, null);
    assert.equal((await balance()).total, 0);
});
test('下架或删除问题同时撤回采纳和加分', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    const hide = await h.api('PUT', `/contents/${q}/moderation`, 'teacher-a', { revision: await h.revision(q), action: 'hide', reason: '问题需要审查' });
    assert.equal(hide.status, 200); assert.equal((await balance()).total, 0);
    assert.equal((await h.api('GET', `/contents/${a}`)).status, 404);
});
test('显式调分产生冲销与新奖励，课程配置变化不重算已采纳答案', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    await h.policy(true, 9); assert.equal((await balance()).total, 200);
    const r = await h.api('PATCH', `/questions/${q}/award`, 'teacher-a', { revision: await h.revision(q), bonusPoints: 3.25, reason: '根据答案贡献调整' });
    assert.equal(r.status, 200); assert.deepEqual(await balance(), { total: 325, entries: 3 });
    await h.accept(q, null); assert.equal((await balance()).total, 0);
});
test('并发采纳同一 revision 只能有一个有效状态，不会重复加分', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q), b = await h.postAnswer(q, 'student-a');
    const results = await Promise.all([a, b].map(answerId => h.api('PUT', `/questions/${q}/acceptance`, 'teacher-a', { revision: 1, answerId })));
    assert.ok(results.some(r => r.status === 200)); assert.ok(results.every(r => [200, 409].includes(r.status)));
    const entries = await h.database.prepare('SELECT COUNT(*) AS n,SUM(delta_cents) AS total FROM bonus_ledger').first();
    assert.equal(entries.n, 1); assert.equal(entries.total, 200);
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
    await assert.rejects(() => h.database.prepare('UPDATE bonus_ledger SET delta_cents=999').run(), /immutable_ledger/);
    await assert.rejects(() => h.database.prepare('DELETE FROM bonus_ledger').run(), /immutable_ledger/);
});