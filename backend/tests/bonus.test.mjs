import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, setCurrentTerm, doc } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const points = async (student = 'student-b', term = 'term-active') => h.database.prepare(
    'SELECT COALESCE(SUM(delta_points),0) AS points FROM bonus_ledger WHERE course_id=? AND term_id=? AND student_id=?'
).bind('course-a', term, student).first('points');
const moderation = async (id, action) => h.api('PUT', `/contents/${id}/moderation`, 'teacher-a', {
    revision: await h.database.prepare('SELECT revision FROM contents WHERE id=?').bind(id).first('revision'), action, reason: '测试上下架原因',
});
const adjustment = (deltaPoints, options = {}, as = 'teacher-a') => h.api('POST', '/courses/course-a/bonus-adjustments', as,
    { studentId: 'student-b', termId: 'term-active', deltaPoints, reason: '课堂贡献调整' }, options);

test('five independent nonnegative integer rules replace enabled and decimal policies', async () => {
    const configured = await h.policy({ questionPoints: 10, answerPoints: 25, acceptancePoints: 50, commentPoints: 1, materialPoints: 40, materialPerVersion: true });
    assert.deepEqual(configured.data.bonusPolicy, { questionPoints: 10, answerPoints: 25, acceptancePoints: 50, commentPoints: 1, materialPoints: 40, materialPerVersion: true });
    assert.equal('bonusEnabled' in configured.data, false);
    for (const value of [-1, 1.5]) {
        const response = await h.api('PUT', '/courses/course-a/bonus-policy', 'teacher-a', { revision: configured.data.revision, ...configured.data.bonusPolicy, answerPoints: value });
        assert.equal(response.status, 400);
        await assert.rejects(h.database.prepare('UPDATE courses SET answer_points=? WHERE id=?').bind(value, 'course-a').run(), /courses_answer_points/);
    }
});

test('question, answer and comment rewards belong to the exact course, term and enrolled student', async () => {
    await h.policy({ questionPoints: 10, answerPoints: 25, commentPoints: 3 });
    const body = { title: '计分问题', body: doc('正文') }, options = { key: 'question-points-request' };
    const first = await h.api('POST', '/courses/course-a/questions', 'student-a', body, options);
    assert.equal(first.status, 201);
    const repeated = await h.api('POST', '/courses/course-a/questions', 'student-a', body, options);
    assert.equal(repeated.data.id, first.data.id);
    const a = await h.postAnswer(first.data.id);
    assert.equal((await h.api('POST', '/comments', 'student-b', { targetKind: 'answer', targetId: a, body: doc('补充评论') })).status, 201);
    await h.postAnswer(first.data.id, 'visitor'); await h.postAnswer(first.data.id, 'teacher-a');
    assert.equal(await points('student-a'), 10); assert.equal(await points(), 28);
    assert.equal(await points('visitor'), 0); assert.equal(await points('teacher-a'), 0);
    await setCurrentTerm(h.database, 'term-old');
    await h.postQuestion('visitor');
    assert.equal(await points('visitor', 'term-old'), 10);
    assert.equal(await points('visitor'), 0);
    assert.equal(await h.database.prepare("SELECT count(*) AS n FROM bonus_ledger WHERE course_id='course-b'").first('n'), 0);
});

test('hidden ancestors revoke descendant rewards; restoration uses original values and respects other hidden ancestors', async () => {
    await h.policy({ questionPoints: 10, answerPoints: 25, acceptancePoints: 50, commentPoints: 3 });
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    await h.accept(q, a);
    await h.api('POST', '/comments', 'student-b', { targetKind: 'answer', targetId: a, body: doc('答复') });
    assert.equal(await points(), 78);
    assert.equal((await moderation(q, 'hide')).status, 200);
    assert.equal(await points(), 0); assert.equal(await points('student-a'), 0);
    assert.equal((await moderation(a, 'hide')).status, 200);
    await h.policy({ questionPoints: 99, answerPoints: 99, acceptancePoints: 99, commentPoints: 99 });
    assert.equal((await moderation(q, 'restore')).status, 200);
    assert.equal(await points(), 0); assert.equal(await points('student-a'), 10);
    assert.equal((await moderation(a, 'restore')).status, 200);
    assert.equal(await points(), 78);
    const before = await h.database.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n');
    await moderation(a, 'restore');
    assert.equal(await h.database.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n'), before);
    assert.equal((await h.api('GET', `/questions/${q}`)).data.acceptedAnswerId, a);
    assert.equal(await h.database.prepare('SELECT count(*) AS n FROM bonus_ledger WHERE operation=\'restore\' AND term_id<>\'term-active\'').first('n'), 0);
});

test('material rewards use the uploader and composite version identity; physical deletion keeps ledger history', async () => {
    await h.policy({ materialPoints: 40 });
    await h.database.prepare(`INSERT INTO contents(id,kind,course_id,author_id,title,body,updated_by,request_key,request_hash)
        VALUES ('new-material','material','course-a','student-a','讲义',NULL,'student-a','new-material-request','fixture')`).run();
    const version = n => h.database.prepare(`INSERT INTO file_versions(material_id,version,filename,uploaded_by,updated_by)
        VALUES ('new-material',?,'讲义.pdf','student-b','student-b')`).bind(n).run();
    await version(1); await version(2);
    assert.equal(await points(), 40); assert.equal(await points('student-a'), 0);
    await assert.rejects(version(2), /UNIQUE/);
    assert.equal(await h.database.prepare("SELECT source_id FROM bonus_ledger WHERE source_kind='material'").first('source_id'), 'new-material@1');
    await h.database.prepare("UPDATE file_versions SET status='hidden',updated_by='teacher-a' WHERE material_id='new-material' AND version=1").run();
    assert.equal(await points(), 0);
    await h.database.prepare("UPDATE file_versions SET status='visible' WHERE material_id='new-material' AND version=1").run();
    assert.equal(await points(), 40);
    await h.database.prepare("DELETE FROM file_versions WHERE material_id='new-material' AND version=1").run();
    assert.equal(await points(), 0);
    const last = await h.database.prepare('SELECT operation,operator_id FROM bonus_ledger ORDER BY id DESC LIMIT 1').first();
    assert.deepEqual(last, { operation: 'revoke', operator_id: 'teacher-a' });
    await h.policy({ materialPoints: 60, materialPerVersion: true }); await version(3); await version(4);
    assert.equal(await points(), 120);
    await assert.rejects(h.database.prepare("UPDATE file_versions SET status='deleted' WHERE material_id='new-material'").run(), /file_versions_status/);
    assert.deepEqual((await h.database.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('manual positive and negative adjustments are idempotent and independent of content visibility', async () => {
    assert.equal((await adjustment(100, {key:'manual-plus'})).status, 201);
    assert.equal((await adjustment(-30, {key:'manual-minus'})).status, 201);
    const replay = await adjustment(-30, {key:'manual-minus'});
    assert.equal(replay.status, 201); assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    assert.equal((await adjustment(-31, {key:'manual-minus'})).status, 409);
    assert.equal(await points(), 70);
    const q = await h.postQuestion(); await moderation(q, 'hide'); await moderation(q, 'restore');
    assert.equal(await points(), 70);
    const summary = await h.api('GET', '/courses/course-a/bonus-summary?termId=term-active', 'teacher-a');
    assert.equal(summary.data.items[0].totalPoints, 70); assert.equal('totalCents' in summary.data.items[0], false);
    assert.equal((await h.api('GET', '/me/bonus-ledger', 'student-b')).data.items[0].deltaPoints, -30);
    for (const value of [0, 1.5]) assert.equal((await adjustment(value)).status, 400);
    for (const as of ['student-a','teacher-b']) assert.equal((await adjustment(10, {}, as)).status, 403);
    assert.equal((await h.api('POST', '/courses/course-a/bonus-adjustments', 'teacher-a',
        { studentId: 'visitor', termId: 'term-active', deltaPoints: 10, reason: '未修读' })).status, 409);
});

test('rule changes do not create retroactive rewards for content originally worth zero', async () => {
    const q = await h.postQuestion(); await h.policy({ questionPoints: 100 });
    await moderation(q, 'hide'); await moderation(q, 'restore');
    assert.equal(await points('student-a'), 0);
    await h.postQuestion(); assert.equal(await points('student-a'), 100);
});

test('score failures roll back publication, acceptance and manual adjustments', async () => {
    await h.policy({ questionPoints: 10, acceptancePoints: 50 });
    const q = await h.postQuestion(), a = await h.postAnswer(q);
    const before = (await h.database.prepare('SELECT * FROM business_events ORDER BY seq').all()).results;
    await h.database.prepare("CREATE TRIGGER fail_points BEFORE INSERT ON bonus_ledger BEGIN SELECT RAISE(ABORT,'simulated_failure'); END").run();
    assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '失败', body: doc('失败') })).status, 500);
    assert.equal((await h.accept(q, a)).status, 500);
    assert.equal((await adjustment(10)).status, 500);
    assert.equal(await h.database.prepare("SELECT count(*) AS n FROM contents WHERE kind='question'").first('n'), 1);
    assert.equal(await h.database.prepare('SELECT count(*) AS n FROM acceptances').first('n'), 0);
    assert.deepEqual((await h.database.prepare('SELECT * FROM business_events ORDER BY seq').all()).results, before);
});

test('ledger reversal chains are immutable and cannot change amount, recipient or attribution', async () => {
    await h.policy({ questionPoints: 10 }); const q = await h.postQuestion(); await moderation(q, 'hide');
    const [award, revoke] = (await h.database.prepare('SELECT * FROM bonus_ledger ORDER BY id').all()).results;
    assert.equal(revoke.reverses_id, award.id); assert.equal(revoke.delta_points, -10);
    await assert.rejects(h.database.prepare('UPDATE bonus_ledger SET delta_points=1').run(), /immutable_ledger/);
    await assert.rejects(h.database.prepare('DELETE FROM bonus_ledger').run(), /immutable_ledger/);
    await assert.rejects(h.database.prepare(`INSERT INTO bonus_ledger(operation,course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,reason,reverses_id)
        VALUES ('restore','course-a','term-active','student-b',10,'question',?,'teacher-a','错误收款人',?)`).bind(q,revoke.id).run(), /invalid_bonus_reversal/);
});