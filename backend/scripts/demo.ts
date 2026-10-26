import assert from 'node:assert/strict';
import { start } from '../tests/harness';

const h = await start();
try {
  await h.policy(true, 2);
  const q = await h.postQuestion('student-a', { fileVersionId: 'version-a1', tags: ['极限'] });
  const a = await h.postAnswer(q, 'student-b');
  const accepted = await h.accept(q, a);
  assert.equal(accepted.status, 200);
  const awarded = await h.api('GET', '/me/bonus-ledger', 'student-b');
  const repeat = await h.accept(q, a);
  assert.equal(repeat.data.changed, false);
  const hidden = await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '演示内容审查' });
  assert.equal(hidden.status, 200);
  const after = await h.api('GET', `/questions/${q}`);
  const ledger = await h.api('GET', '/me/bonus-ledger', 'student-b');
  const balance = ledger.data.items.reduce((sum: number, item: { deltaCents: number }) => sum + item.deltaCents, 0);
  assert.equal(balance, 0);
  console.log(JSON.stringify({
    demo: '真实 Worker + 本地 D1 的临时演示；不读写云端或日常开发库',
    linkedVersion: 'version-a1', accepted: accepted.data.solved,
    awardedPoints: awarded.data.items[0].deltaPoints, repeatedAcceptanceChanged: repeat.data.changed,
    hiddenAnswerAvailable: (await h.api('GET', `/contents/${a}`)).status === 200,
    solvedAfterHide: after.data.solved, finalBonusPoints: balance / 100,
    ledger: ledger.data.items.map((r: { operation: string; deltaPoints: number }) => ({ operation: r.operation, deltaPoints: r.deltaPoints })),
  }, null, 2));
} finally { await h.dispose(); }