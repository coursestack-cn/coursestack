import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readMigrations } from '../scripts/lib/migrations.mjs';
import worker from '../src/index.ts';

let runtime, migrations;
before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21', d1Databases: ['LEGACY', 'MULTI_ROLE'],
    }));
    migrations = await readMigrations();
});
after(async () => { await runtime?.dispose(); });
const apply = async (db, history) => {
    for (const { statements } of history) await db.batch(statements.map(s => db.prepare(s)));
};

test('populated legacy courses and both historical and current membership survive 0006–0011', async () => {
    const db = await runtime.getD1Database('LEGACY');
    await apply(db, migrations.slice(0, 5));
    await db.exec(`
INSERT INTO accounts(id,public_name) VALUES ('teacher','教师'),('student','学生');
INSERT INTO account_roles VALUES ('teacher','teacher'),('student','student');
INSERT INTO courses(id,name,created_at) VALUES ('a','旧课程甲',100),('b','旧课程乙',200);
INSERT INTO terms VALUES ('past','过去'),('current','当前');
UPDATE academic_settings SET current_term_id='current' WHERE id=1;
INSERT INTO teaching_assignments(course_id,term_id,teacher_id) VALUES ('a','past','teacher'),('a','current','teacher');
INSERT INTO enrollments(course_id,term_id,student_id) VALUES ('a','past','student'),('b','current','student');
`);
    const original = await db.prepare('SELECT course_id, term_id, teacher_id, created_at FROM teaching_assignments ORDER BY term_id').all();
    const enrollments = await db.prepare('SELECT course_id, term_id, student_id, created_at FROM enrollments ORDER BY term_id').all();
    await apply(db, migrations.slice(5, migrations.findIndex(m => m.name.startsWith('0012_'))));
    assert.deepEqual((await db.prepare('SELECT course_id, term_id, teacher_id, created_at FROM teaching_assignments ORDER BY term_id').all()).results, original.results);
    assert.deepEqual((await db.prepare('SELECT course_id, term_id, student_id, created_at FROM enrollments ORDER BY term_id').all()).results, enrollments.results);
    assert.deepEqual((await db.prepare('SELECT id,code,created_at,updated_at,created_by FROM courses ORDER BY id').all()).results,
        [{ id: 'a', code: '', created_at: 100, updated_at: 100, created_by: null }, { id: 'b', code: '', created_at: 200, updated_at: 200, created_by: null }]);
    await db.prepare("INSERT INTO courses(id,name,created_at) VALUES ('later','基础课程',300)").run();
    const response = await worker.fetch(new Request('http://localhost/api/courses/later'), { DB: db, APP_ENV: 'local' });
    assert.equal(response.status, 200); assert.equal((await response.json()).data.updatedAt, 300);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM business_events').first('n'), 0);
    await db.prepare("UPDATE courses SET code='UNIQUE01' WHERE id='a'").run();
    await assert.rejects(() => db.prepare("UPDATE courses SET code='UNIQUE01' WHERE id='b'").run(), /UNIQUE constraint/);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    const names = (await db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all()).results.map(r => r.name);
    for (const name of ['content_insert_guard','content_identity_immutable','file_version_material_insert','file_version_material_update','acceptance_guard','acceptance_ledger','answer_unavailable',
        'ledger_no_update','ledger_no_delete','moderation_audit','content_created_event','content_updated_event','course_created_event','course_updated_event']) assert.ok(names.includes(name), name);
    assert.ok(!names.includes('course_creator_teaching'));
    assert.ok(await db.prepare("SELECT name FROM sqlite_schema WHERE type='view' AND name='public_contents'").first());
});

test('single-identity migration refuses historical multiple roles without discarding either role', async () => {
    const db = await runtime.getD1Database('MULTI_ROLE');
    await apply(db, migrations.slice(0, 5));
    await db.exec("INSERT INTO accounts(id,public_name) VALUES ('dual','历史多身份');\nINSERT INTO account_roles VALUES ('dual','student'),('dual','teacher');");
    await assert.rejects(() => apply(db, [migrations[5]]), /UNIQUE constraint/);
    assert.deepEqual((await db.prepare("SELECT role FROM account_roles WHERE account_id='dual' ORDER BY role").all()).results, [{ role: 'student' }, { role: 'teacher' }]);
});