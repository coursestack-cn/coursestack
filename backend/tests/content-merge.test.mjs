import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readMigrations } from '../scripts/lib/migrations.mjs';

let runtime, history, merge;
before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21', d1Databases: ['MERGE', 'COLLISION'],
    }));
    const migrations = await readMigrations();
    const index = migrations.findIndex(m => m.name === '0011_merge_material_contents.sql');
    history = migrations.slice(0, index); merge = migrations[index];
});
after(async () => { await runtime?.dispose(); });
const apply = async (db, migrations) => {
    for (const { statements } of migrations) await db.batch(statements.map(s => db.prepare(s)));
};
const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const prepare = async name => {
    const db = await runtime.getD1Database(name);
    await apply(db, history);
    await db.batch([
        "INSERT INTO accounts(id,nickname,role) VALUES ('student','学生','student'),('teacher','教师','teacher')",
        "INSERT INTO courses(id,name) VALUES ('course','旧课程')",
        "INSERT INTO terms(id,name) VALUES ('term','旧学期')",
        "INSERT INTO materials VALUES ('material','course','student','旧讲义','visible'),('deleted-material','course','teacher','旧标题','deleted')",
        "INSERT INTO file_versions VALUES ('v1','material','讲义-v1.pdf',1,'visible'),('v2','material','讲义-v2.pdf',2,'visible')",
        "INSERT INTO contents(id,kind,course_id,author_id,title,body,file_version_id,updated_by,request_key,request_hash) VALUES ('question','question','course','student','旧问题','原正文','v1','student','create-question','hash')",
    ].map(sql => db.prepare(sql)));
    return db;
};

test('0011 preserves material IDs, files, direct reply ancestry, acceptance and dependent history', async () => {
    const db = await prepare('MERGE');
    await db.batch([
        "INSERT INTO contents(id,kind,course_id,author_id,body,question_id,updated_by,request_key,request_hash) VALUES ('answer','answer','course','student','原回答','question','student','create-answer','hash')",
        "INSERT INTO contents(id,kind,course_id,author_id,body,target_kind,target_id,updated_by,request_key,request_hash) VALUES ('parent','comment','course','teacher','父评论','material','material','teacher','create-parent','hash'),('answer-comment','comment','course','teacher','回答评论','answer','answer','teacher','create-answer-comment','hash')",
        "INSERT INTO contents(id,kind,course_id,author_id,body,target_kind,target_id,reply_to_id,updated_by,request_key,request_hash) VALUES ('reply','comment','course','student','子评论','material','material','parent','student','create-reply','hash')",
        "UPDATE contents SET status='deleted',revision=2 WHERE id='parent'",
        "UPDATE contents SET accepted_answer_id='answer',accepted_by='teacher',accepted_at=100,accepted_term_id='term',acceptance_id='acceptance',award_cents=200,award_eligible=1,updated_by='teacher',revision=2 WHERE id='question'",
        "INSERT INTO votes(content_id,user_id,value) VALUES ('answer','teacher',1)",
        "INSERT INTO reports(id,content_id,reporter_id,reason,request_key,request_hash) VALUES ('report','answer','teacher','审查原因','create-report','hash')",
        "UPDATE contents SET status='hidden',revision=2 WHERE id='answer-comment'",
        "UPDATE file_versions SET status='hidden' WHERE id='v1'",
    ].map(sql => db.prepare(sql)));
    const preserved = ['file_versions', 'votes', 'bonus_ledger', 'reports', 'moderation_actions'];
    const before = await Promise.all(preserved.map(t => rows(db, `SELECT * FROM ${t} ORDER BY rowid`)));
    const oldEvents = await rows(db, 'SELECT seq,event_id,type,content_id,created_at,acknowledged_at FROM business_events ORDER BY seq');
    await apply(db, [merge]);
    assert.deepEqual(await Promise.all(preserved.map(t => rows(db, `SELECT * FROM ${t} ORDER BY rowid`))), before);
    assert.deepEqual(await rows(db, 'SELECT seq,event_id,type,content_id,created_at,acknowledged_at FROM business_events ORDER BY seq'), oldEvents);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='materials'").first('n'), 0);
    const columns = (await rows(db, 'PRAGMA table_info(contents)')).map(c => c.name);
    for (const removed of ['question_id', 'reply_to_id', 'file_version_id']) assert.ok(!columns.includes(removed));
    assert.deepEqual(await db.prepare("SELECT kind,title,body,request_key,request_hash FROM contents WHERE id='material'").first(),
        { kind: 'material', title: '旧讲义', body: '', request_key: null, request_hash: null });
    assert.deepEqual(await db.prepare("SELECT title,body,status FROM contents WHERE id='deleted-material'").first(), { title: '', body: '', status: 'deleted' });
    assert.equal(await db.prepare("SELECT body FROM contents WHERE id='question'").first('body'), '原正文\n\n[关联资料版本](/materials/material/versions/v1)');
    assert.equal(await db.prepare("SELECT accepted_answer_id FROM contents WHERE id='question'").first('accepted_answer_id'), 'answer');
    assert.deepEqual(await rows(db, "SELECT id,target_kind,target_id FROM contents WHERE kind IN ('answer','comment') ORDER BY id"), [
        { id: 'answer', target_kind: 'question', target_id: 'question' },
        { id: 'answer-comment', target_kind: 'answer', target_id: 'answer' },
        { id: 'parent', target_kind: 'material', target_id: 'material' },
        { id: 'reply', target_kind: 'comment', target_id: 'parent' },
    ]);
    assert.equal(await db.prepare("SELECT body FROM contents WHERE id='parent'").first('body'), '');
    assert.ok(await db.prepare("SELECT id FROM public_contents WHERE id='reply'").first());
    assert.equal(await db.prepare("SELECT id FROM public_contents WHERE id='answer-comment'").first(), null);
    const events = await rows(db, 'SELECT payload FROM business_events WHERE content_id IS NOT NULL');
    for (const { payload } of events) {
        const event = JSON.parse(payload);
        for (const key of ['questionId', 'replyToId', 'fileVersionId', 'questionAuthorId', 'replyAuthorId']) assert.equal(event[key], undefined);
        if (event.id === 'answer') assert.equal(event.targetId, 'question');
        if (event.id === 'reply') {
            assert.equal(event.targetKind, 'comment'); assert.equal(event.targetId, 'parent'); assert.equal(event.targetAuthorId, 'teacher');
        }
    }
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
    // The rebuilt acceptance trigger must still revoke the preserved award.
    await db.prepare("UPDATE contents SET status='hidden',revision=revision+1 WHERE id='answer'").run();
    assert.equal(await db.prepare('SELECT SUM(delta_cents) AS total FROM bonus_ledger').first('total'), 0);
});

test('0011 refuses overlapping material/content IDs and rolls back without discarding either row', async () => {
    const db = await prepare('COLLISION');
    await db.prepare("INSERT INTO materials VALUES ('question','course','teacher','同 ID 资料','visible')").run();
    const before = await rows(db, 'SELECT type,name,sql FROM sqlite_schema ORDER BY type,name');
    await assert.rejects(() => apply(db, [merge]), /content_identity_merge_conflict/);
    assert.deepEqual(await rows(db, 'SELECT type,name,sql FROM sqlite_schema ORDER BY type,name'), before);
    assert.equal(await db.prepare("SELECT title FROM materials WHERE id='question'").first('title'), '同 ID 资料');
    assert.equal(await db.prepare("SELECT body FROM contents WHERE id='question'").first('body'), '原正文');
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});