import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readMigrations } from '../scripts/lib/migrations.mjs';

let runtime, history, merge;
before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21', d1Databases: ['VALID', 'MULTIPLE', 'MISSING', 'ORPHAN', 'TAGS'],
    }));
    const migrations = await readMigrations();
    const index = migrations.findIndex(m => m.name === '0012_simplify_academics_and_content_metadata.sql');
    history = migrations.slice(0, index); merge = migrations[index];
});
after(async () => { await runtime?.dispose(); });
const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const apply = async (db, migrations) => {
    for (const { statements } of migrations) await db.batch(statements.map(s => db.prepare(s)));
};
const prepare = async name => {
    const db = await runtime.getD1Database(name);
    await apply(db, history);
    await db.batch([
        "INSERT INTO accounts(id,nickname,role) VALUES ('teacher','教师','teacher'),('other','另一教师','teacher'),('student','学生','student')",
        "INSERT INTO terms(id,name) VALUES ('past','历史学期'),('current','当前学期')",
        "UPDATE academic_settings SET current_term_id='current' WHERE id=1",
        "INSERT INTO courses(id,name) VALUES ('course','课程')",
        "INSERT INTO teaching_assignments(course_id,term_id,teacher_id) VALUES ('course','past','other'),('course','current','teacher')",
        "INSERT INTO enrollments(course_id,term_id,student_id) VALUES ('course','past','student'),('course','current','student')",
        `INSERT INTO contents(id,kind,course_id,author_id,title,body,tags,updated_by) VALUES
            ('question','question','course','student','问题','问题正文','["标签"]','student'),
            ('material','material','course','teacher','讲义','资料简介','[]','teacher')`,
        "INSERT INTO contents(id,kind,course_id,author_id,body,target_kind,target_id,updated_by) VALUES ('answer','answer','course','student','回答正文','question','question','student'),('comment','comment','course','student','评论正文','material','material','student')",
        "INSERT INTO file_versions VALUES ('version','material','讲义.pdf',1,'visible')",
        "UPDATE contents SET accepted_answer_id='answer',accepted_by='teacher',accepted_at=100,accepted_term_id='current',acceptance_id='acceptance',award_cents=200,award_eligible=1,updated_by='teacher',revision=2,change_reason='acceptance.changed' WHERE id='question'",
        "UPDATE contents SET status='hidden',revision=2,updated_by='teacher',change_reason='需要核对内容' WHERE id='comment'",
    ].map(s => db.prepare(s)));
    return db;
};

test('0012 merges populated academic tables and preserves content, files and explanation history', async () => {
    const db = await prepare('VALID');
    const members = await rows(db, `SELECT course_id,term_id,teacher_id AS account_id FROM teaching_assignments
        UNION ALL SELECT course_id,term_id,student_id FROM enrollments ORDER BY course_id,term_id,account_id`);
    const preserved = ['accounts', 'courses', 'file_versions', 'bonus_ledger', 'moderation_actions', 'business_events'];
    const before = await Promise.all(preserved.map(t => rows(db, `SELECT * FROM ${t} ORDER BY rowid`)));
    const content = (await rows(db, 'SELECT * FROM contents ORDER BY id')).map(({ change_reason, ...row }) => ({ ...row, tags: row.tags === '[]' ? null : row.tags }));
    await apply(db, [merge]);
    assert.deepEqual(await Promise.all(preserved.map(t => rows(db, `SELECT * FROM ${t} ORDER BY rowid`))), before);
    assert.deepEqual(await rows(db, 'SELECT * FROM contents ORDER BY id'), content);
    assert.deepEqual(await rows(db, 'SELECT * FROM enrollments ORDER BY course_id,term_id,account_id'), members);
    assert.deepEqual(await rows(db, 'SELECT id,current FROM terms ORDER BY id'), [{ id: 'current', current: 1 }, { id: 'past', current: 0 }]);
    assert.deepEqual(await rows(db, "SELECT name FROM sqlite_schema WHERE name IN ('academic_settings','teaching_assignments')"), []);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
    await db.prepare("UPDATE contents SET status='hidden',revision=revision+1 WHERE id='answer'").run();
    assert.equal(await db.prepare('SELECT SUM(delta_cents) AS n FROM bonus_ledger').first('n'), 0);
    assert.equal(await db.prepare('SELECT reason FROM bonus_ledger ORDER BY id DESC LIMIT 1').first('reason'), 'answer.hidden');
});

for (const [name, sql] of [
    ['MULTIPLE', "INSERT INTO teaching_assignments(course_id,term_id,teacher_id) VALUES ('course','current','other')"],
    ['MISSING', "DELETE FROM teaching_assignments WHERE term_id='past'"],
    ['ORPHAN', "INSERT INTO courses(id,name) VALUES ('orphan','缺少教师的课程')"],
    ['TAGS', `UPDATE contents SET tags='["不支持的标签"]' WHERE id='answer'`],
]) test(`0012 refuses ${name.toLowerCase()} conflicts and preserves the original database`, async () => {
    const db = await prepare(name);
    await db.prepare(sql).run();
    const structure = await rows(db, 'SELECT type,name,sql FROM sqlite_schema ORDER BY type,name');
    const tables = ['terms', 'academic_settings', 'teaching_assignments', 'enrollments', 'contents', 'bonus_ledger', 'moderation_actions'];
    const before = await Promise.all(tables.map(t => rows(db, `SELECT * FROM ${t} ORDER BY rowid`)));
    await assert.rejects(() => apply(db, [merge]), /academic_merge_conflict/);
    assert.deepEqual(await rows(db, 'SELECT type,name,sql FROM sqlite_schema ORDER BY type,name'), structure);
    assert.deepEqual(await Promise.all(tables.map(t => rows(db, `SELECT * FROM ${t} ORDER BY rowid`))), before);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});