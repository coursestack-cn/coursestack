import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, setCurrentTerm } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });

test('terms.current is binary and unique; switching terms preserves all memberships', async () => {
    const before = (await h.database.prepare('SELECT * FROM enrollments ORDER BY course_id,term_id,account_id').all()).results;
    await assert.rejects(() => h.database.prepare("UPDATE terms SET current=1 WHERE id='term-old'").run(), /UNIQUE/);
    await assert.rejects(() => h.database.prepare("UPDATE terms SET current=2 WHERE id='term-old'").run(), /terms_current/);
    await setCurrentTerm(h.database, 'term-old');
    assert.equal(await h.database.prepare('SELECT id FROM terms WHERE current=1').first('id'), 'term-old');
    assert.deepEqual((await h.database.prepare('SELECT * FROM enrollments ORDER BY course_id,term_id,account_id').all()).results, before);
    assert.equal((await h.api('GET', '/courses/course-a/entry', 'teacher-a')).data.permissions.canManage, false);
    assert.equal((await h.api('GET', '/courses/course-a/entry', 'teacher-b')).data.permissions.canManage, true);
});

test('course creation requires a current-term teacher but no students; admin explicitly chooses the teacher', async () => {
    assert.equal((await h.api('POST', '/courses', 'admin', { name: '无教师', code: 'NO_TEACHER' })).status, 400);
    assert.equal((await h.api('POST', '/courses', 'admin', { name: '错误教师', code: 'BAD_TEACHER', teacherId: 'student-a' })).status, 400);
    assert.equal((await h.api('POST', '/courses', 'teacher-a', { name: '指定旧学期', code: 'PAST', termId: 'term-old' })).status, 400);
    const made = await h.api('POST', '/courses', 'admin', { name: '仅教师课程', code: 'TEACHER_ONLY', teacherId: 'teacher-b' });
    assert.equal(made.status, 201);
    assert.deepEqual((await h.database.prepare('SELECT * FROM enrollments WHERE course_id=?').bind(made.data.id).all()).results,
        [{ course_id: made.data.id, term_id: 'term-active', account_id: 'teacher-b' }]);
    assert.equal(await h.database.prepare('SELECT created_by FROM courses WHERE id=?').bind(made.data.id).first('created_by'), 'admin');
    await assert.rejects(() => h.database.prepare('DELETE FROM enrollments WHERE course_id=?').bind(made.data.id).run(), /course_requires_teacher/);
    await assert.rejects(() => h.database.prepare("INSERT INTO courses(id,name) VALUES ('orphan','无教师课程')").run(), /course_requires_teacher/);
    await setCurrentTerm(h.database, null);
    assert.equal((await h.api('POST', '/courses', 'admin', { name: '未设置学期', code: 'NO_TERM', teacherId: 'teacher-a' })).status, 409);
});

test('membership triggers enforce one teacher, prohibit past instances and permit atomic teacher replacement', async () => {
    const db = h.database;
    await assert.rejects(() => db.prepare("INSERT INTO enrollments VALUES ('course-a','term-active','teacher-b')").run(), /enrollment_teacher_unique/);
    await assert.rejects(() => db.prepare("INSERT INTO enrollments VALUES ('course-a','term-active','admin')").run(), /invalid_enrollment_identity/);
    await assert.rejects(() => db.prepare("UPDATE accounts SET role='student' WHERE id='teacher-a'").run(), /replace_account_identity/);
    await assert.rejects(() => db.prepare("INSERT INTO enrollments VALUES ('course-b','term-old','teacher-a')").run(), /current_term_required/);
    await assert.rejects(() => db.prepare("DELETE FROM enrollments WHERE course_id='course-a' AND term_id='term-active' AND account_id='teacher-a'").run(), /enrollment_teacher_required/);
    await assert.rejects(() => db.prepare("UPDATE enrollments SET account_id='visitor' WHERE course_id='course-a' AND term_id='term-active' AND account_id='teacher-a'").run(), /enrollment_teacher_required/);
    await db.prepare("UPDATE enrollments SET account_id='teacher-b' WHERE course_id='course-a' AND term_id='term-active' AND account_id='teacher-a'").run();
    assert.equal((await h.api('GET', '/courses/course-a/entry', 'teacher-a')).data.permissions.canManage, false);
    assert.equal((await h.api('GET', '/courses/course-a/entry', 'teacher-b')).data.permissions.canManage, true);
    await assert.rejects(() => db.prepare("UPDATE enrollments SET term_id='term-old' WHERE course_id='course-a' AND term_id='term-active' AND account_id='teacher-b'").run(), /enrollment_instance_immutable/);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('concurrent attempts to create the same new instance admit exactly one teacher', async () => {
    await h.database.prepare("INSERT INTO terms(id,name) VALUES ('next','下一学期')").run();
    await setCurrentTerm(h.database, 'next');
    await assert.rejects(() => h.database.prepare("INSERT INTO enrollments VALUES ('course-a','next','student-a')").run(), /enrollment_teacher_required/);
    const results = await Promise.allSettled(['teacher-a', 'teacher-b'].map(id =>
        h.database.prepare("INSERT INTO enrollments VALUES ('course-a','next',?)").bind(id).run()));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await h.database.prepare("SELECT count(*) AS n FROM enrollments WHERE course_id='course-a' AND term_id='next'").first('n'), 1);
});

test('tags are nullable and only questions/materials may store a JSON array', async () => {
    const q = await h.postQuestion('student-a', { tags: ['标签'] }), a = await h.postAnswer(q);
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'question', targetId: q, body: '评论' });
    for (const id of [a, comment.data.id]) {
        assert.equal((await h.api('GET', `/contents/${id}`)).data.tags, null);
        for (const tags of ['[]', '["标签"]']) await assert.rejects(() => h.database.prepare('UPDATE contents SET tags=? WHERE id=?').bind(tags, id).run(), /contents_tags/);
    }
    for (const id of [q, 'material-a']) {
        const changed = await h.api('PATCH', `/contents/${id}`, 'student-a', { revision: 1, tags: null });
        assert.equal(changed.status, 200); assert.equal(changed.data.tags, null);
        await assert.rejects(() => h.database.prepare("UPDATE contents SET tags='{}' WHERE id=?").bind(id).run(), /contents_tags/);
    }
});

test('moderation and award explanations live in their history records and roll back with failed mutations', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q); await h.accept(q, a);
    const adjusted = await h.api('PATCH', `/questions/${q}/award`, 'teacher-a', { revision: await h.revision(q), bonusPoints: 3, reason: '补充了完整证明' });
    assert.equal(adjusted.status, 200);
    const reasons = (await h.database.prepare('SELECT reason FROM bonus_ledger ORDER BY id DESC LIMIT 2').all()).results;
    assert.deepEqual(reasons, [{ reason: 'award.adjusted: 补充了完整证明' }, { reason: 'award.adjusted: 补充了完整证明' }]);
    const count = await h.database.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n');
    await h.database.prepare("CREATE TRIGGER fail_content_update BEFORE UPDATE ON contents BEGIN SELECT RAISE(ABORT,'simulated_failure'); END").run();
    assert.equal((await h.api('PATCH', `/questions/${q}/award`, 'teacher-a', { revision: await h.revision(q), bonusPoints: 4, reason: '失败操作的理由' })).status, 500);
    assert.equal(await h.database.prepare('SELECT count(*) AS n FROM bonus_ledger').first('n'), count);
    assert.equal((await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '广告需要下架' })).status, 500);
    assert.equal(await h.database.prepare('SELECT count(*) AS n FROM moderation_actions').first('n'), 0);
    await h.database.prepare('DROP TRIGGER fail_content_update').run();
    assert.equal((await h.api('PUT', `/contents/${a}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '广告需要下架' })).status, 200);
    assert.equal(await h.database.prepare('SELECT reason FROM moderation_actions').first('reason'), '广告需要下架');
    assert.equal(await h.database.prepare('SELECT reason FROM bonus_ledger ORDER BY id DESC LIMIT 1').first('reason'), 'answer.hidden');
    assert.equal((await h.database.prepare('PRAGMA table_info(contents)').all()).results.some(c => c.name === 'change_reason'), false);
});