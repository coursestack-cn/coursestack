import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { readMigrations } from '../scripts/lib/migrations.mjs';
import { createDatabase } from '../src/db/index.ts';
import { management, classManagement, editPermission } from '../src/permissions.ts';
import { bonusRoutes } from '../src/discussions/bonus.ts';

let runtime, migrations, nextDatabase = 0;
before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
        modules: true, script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21', d1Databases: Array.from({ length: 20 }, (_, i) => `DB${i}`),
    }));
    migrations = await readMigrations();
});
after(async () => { await runtime?.dispose(); });

const rows = async (db, query) => (await db.prepare(query).all()).results;
async function apply(db, history) {
    for (const migration of history) await db.batch(migration.statements.map(statement => db.prepare(statement)));
}
async function database(legacy = false) {
    const db = await runtime.getD1Database(`DB${nextDatabase++}`);
    await apply(db, legacy ? migrations.filter(migration => migration.name < '0004_') : migrations);
    return db;
}
async function batch(db, source) {
    await db.batch(source.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
}
const identities = `INSERT INTO accounts(id,role,school_number) VALUES
    ('admin','admin',NULL),('teacher-a','teacher','T1'),('teacher-b','teacher','T2'),
    ('student-a','student','S1'),('student-b','student','S2'),('visitor','student','S3');`;
async function seed(db) {
    await batch(db, `${identities}
        INSERT INTO terms(id,name,current) VALUES('current','当前学期',1),('past','历史学期',0),('next','下一学期',0);
        INSERT INTO courses(id,name,created_by,request_key,request_hash) VALUES('COURSE','课程','admin','course-key','course-hash');
        INSERT INTO course_terms VALUES('COURSE','current');
        INSERT INTO teaching_classes VALUES('COURSE','current','teacher-a'),('COURSE','current','teacher-b');
        INSERT INTO class_students VALUES('COURSE','current','student-a','teacher-a'),('COURSE','current','student-b','teacher-b');
        UPDATE class_bonus_rules SET points_question=3,points_answer=5,points_acceptance=7,points_comment=2,points_material=11,points_material_version=13 WHERE teacher_id='teacher-a';
        UPDATE class_bonus_rules SET points_question=30,points_answer=50,points_acceptance=70,points_comment=20,points_material=110,points_material_version=130 WHERE teacher_id='teacher-b';`);
}
async function content(db, id, kind, author, target = null) {
    await db.prepare(`INSERT INTO contents(id,kind,course_id,author_id,title,target_id,updated_by,request_key,request_hash)
        VALUES(?,?,'COURSE',?,?,?,?,?,'hash')`).bind(id, kind, author,
            ['question', 'material'].includes(kind) ? id : null, target, author, `request-${id}`).run();
}

test('courses and offerings can be empty; joins require an offered current term and enforce student ownership', async () => {
    const db = await database();
    await batch(db, identities);
    await db.prepare("INSERT INTO courses(id,name,created_by,request_key,request_hash) VALUES('课程/中文 01','无学期课程','admin','empty-course','hash')").run();
    assert.deepEqual(await rows(db, 'SELECT * FROM teaching_classes'), []);
    await assert.rejects(db.prepare("INSERT INTO courses(id,name,created_by,request_key,request_hash) VALUES('ILLEGAL','课程','teacher-a','illegal-course','hash')").run(), /course_admin_required/);
    await batch(db, "INSERT INTO terms(id,name,current) VALUES('current','当前',1),('past','历史',0); INSERT INTO course_terms VALUES('课程/中文 01','current'),('课程/中文 01','past');");
    assert.deepEqual(await rows(db, 'SELECT * FROM teaching_classes'), []);
    await assert.rejects(db.prepare("INSERT INTO teaching_classes VALUES('missing','current','teacher-a')").run(), /FOREIGN KEY/);
    await assert.rejects(db.prepare("INSERT INTO teaching_classes VALUES('课程/中文 01','past','teacher-a')").run(), /current_term_required/);
    await assert.rejects(db.prepare("INSERT INTO teaching_classes VALUES('课程/中文 01','current','student-a')").run(), /invalid_class_teacher/);
    const joined = await Promise.allSettled(['teacher-a', 'teacher-b'].map(teacher =>
        db.prepare("INSERT INTO teaching_classes VALUES('课程/中文 01','current',?)").bind(teacher).run()));
    assert.equal(joined.filter(result => result.status === 'fulfilled').length, 2);
    await assert.rejects(db.prepare("INSERT INTO teaching_classes VALUES('课程/中文 01','current','teacher-a')").run(), /UNIQUE/);
    const registered = await Promise.allSettled(['teacher-a', 'teacher-b'].map(teacher =>
        db.prepare("INSERT INTO class_students VALUES('课程/中文 01','current','student-a',?)").bind(teacher).run()));
    assert.equal(registered.filter(result => result.status === 'fulfilled').length, 1);
    await assert.rejects(db.prepare("INSERT INTO class_students VALUES('课程/中文 01','current','teacher-a','teacher-a')").run(), /invalid_class_student/);
    await assert.rejects(db.prepare("DELETE FROM course_terms WHERE term_id='current'").run(), /FOREIGN KEY/);
    await assert.rejects(db.prepare("UPDATE courses SET id='changed'").run(), /course_identity_immutable/);
    await assert.rejects(db.prepare("UPDATE terms SET current=1 WHERE id='past'").run(), /UNIQUE/);
    await assert.rejects(db.prepare("UPDATE terms SET current=2 WHERE id='past'").run(), /terms_current/);
    for (const rule of await rows(db, 'SELECT * FROM class_bonus_rules')) {
        assert.ok(Object.entries(rule).filter(([key]) => key.startsWith('points_')).every(([, value]) => value === 0));
    }
    const expected = {
        course_terms: ['course_id', 'term_id'], teaching_classes: ['course_id', 'term_id', 'teacher_id'],
        class_students: ['course_id', 'term_id', 'student_id', 'teacher_id'],
        class_bonus_rules: ['course_id', 'term_id', 'teacher_id', 'points_question', 'points_answer', 'points_acceptance', 'points_comment', 'points_material', 'points_material_version'],
    };
    for (const [table, fields] of Object.entries(expected)) assert.deepEqual((await rows(db, `PRAGMA table_info(${table})`)).map(row => row.name), fields);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});

test('all six rewards use the student class, including acceptance by another teacher and material versions', async () => {
    const db = await database(); await seed(db);
    await content(db, 'question-a', 'question', 'student-a');
    await content(db, 'question-b', 'question', 'student-b');
    await content(db, 'answer-b', 'answer', 'student-b', 'question-a');
    await content(db, 'comment-b', 'comment', 'student-b', 'answer-b');
    await db.prepare("INSERT INTO acceptances VALUES('question-a','answer-b','teacher-a',100)").run();
    await content(db, 'material-b', 'material', 'student-b');
    await batch(db, `INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by) VALUES
        ('material-b',1,'file-one',10,'application/pdf','student-b','student-b'),
        ('material-b',2,'file-two',10,'application/pdf','student-b','student-b');`);
    await content(db, 'no-membership', 'question', 'visitor');
    await content(db, 'teacher-question', 'question', 'teacher-a');
    assert.deepEqual(await rows(db, 'SELECT source_kind,source_id,teacher_id,delta_points FROM bonus_ledger ORDER BY id'), [
        { source_kind: 'question', source_id: 'question-a', teacher_id: 'teacher-a', delta_points: 3 },
        { source_kind: 'question', source_id: 'question-b', teacher_id: 'teacher-b', delta_points: 30 },
        { source_kind: 'answer', source_id: 'answer-b', teacher_id: 'teacher-b', delta_points: 50 },
        { source_kind: 'comment', source_id: 'comment-b', teacher_id: 'teacher-b', delta_points: 20 },
        { source_kind: 'acceptance', source_id: 'answer-b', teacher_id: 'teacher-b', delta_points: 70 },
        { source_kind: 'material', source_id: 'material-b@1', teacher_id: 'teacher-b', delta_points: 110 },
        { source_kind: 'material', source_id: 'material-b@2', teacher_id: 'teacher-b', delta_points: 130 },
    ]);
    assert.equal(await db.prepare("SELECT operator_id FROM bonus_ledger WHERE source_kind='acceptance'").first('operator_id'), 'teacher-a');
    await assert.rejects(db.prepare('UPDATE class_bonus_rules SET points_question=-1').run(), /class_bonus_rules_points_question/);
    await assert.rejects(db.prepare('UPDATE class_bonus_rules SET points_answer=1.5').run(), /cannot store REAL/);
    await assert.rejects(db.prepare("INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,request_hash) VALUES('COURSE','current','teacher-a','student-b',1,'manual','bad-class','teacher-a','hash')").run(), /invalid_bonus_class/);
});

test('transfers preserve the award and restoration recalculates in the new class in the original term', async () => {
    const db = await database(); await seed(db);
    await content(db, 'question', 'question', 'student-a');
    const first = await db.prepare('SELECT * FROM bonus_ledger').first();
    await batch(db, `UPDATE class_students SET teacher_id='teacher-b' WHERE student_id='student-a';
        UPDATE class_bonus_rules SET points_question=999;
        UPDATE terms SET current=0; UPDATE terms SET current=1 WHERE id='next';
        UPDATE contents SET status='hidden',updated_by='admin' WHERE id='question';
        UPDATE contents SET status='visible',updated_by='admin' WHERE id='question';`);
    const ledger = await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id');
    assert.deepEqual(ledger.map(row => [row.teacher_id, row.term_id, row.delta_points, row.reverses_id]), [
        ['teacher-b', 'current', 3, null], ['teacher-b', 'current', -3, first.id], ['teacher-b', 'current', 999, ledger[1].id],
    ]);
    await assert.rejects(db.prepare('DELETE FROM bonus_ledger').run(), /immutable_ledger/);
    await assert.rejects(db.prepare('UPDATE bonus_ledger SET delta_points=9').run(), /immutable_ledger/);
    await assert.rejects(db.prepare('UPDATE bonus_ledger SET rowid=rowid+1000').run(), /immutable_ledger/);
    await assert.rejects(db.prepare("UPDATE bonus_ledger SET teacher_id='teacher-a'").run(), /immutable_ledger/);
    await assert.rejects(db.prepare('UPDATE bonus_ledger SET reverses_id=NULL WHERE reverses_id IS NOT NULL').run(), /immutable_ledger/);
    await assert.rejects(db.prepare(`INSERT INTO bonus_ledger(course_id,term_id,teacher_id,student_id,delta_points,source_kind,source_id,operator_id,reverses_id)
        VALUES('COURSE','current','teacher-b','student-a',-3,'question','question','admin',?)`).bind(ledger[2].id).run(), /invalid_bonus_reversal/);
    await db.prepare("DELETE FROM teaching_classes WHERE teacher_id='teacher-a'").run();
    assert.deepEqual(await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id'), ledger);
    assert.deepEqual(await rows(db, "SELECT * FROM class_bonus_rules WHERE teacher_id='teacher-a'"), []);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});

test('removing an enrollment preserves a restored award in another term and its subsequent reversals', async () => {
    const db = await database(); await seed(db);
    await batch(db, `UPDATE class_bonus_rules SET points_answer=0;
        INSERT INTO contents(id,kind,course_id,term_id,author_id,title,updated_by,request_key,request_hash)
          VALUES('question','question','COURSE','current','teacher-a','题目','teacher-a','q','q');
        INSERT INTO contents(id,kind,course_id,term_id,author_id,target_id,updated_by,request_key,request_hash)
          VALUES('answer','answer','COURSE','current','student-b','question','student-b','a','a');
        UPDATE terms SET current=0; UPDATE terms SET current=1 WHERE id='next';
        INSERT INTO course_terms VALUES('COURSE','next');
        INSERT INTO teaching_classes VALUES('COURSE','next','teacher-a');
        INSERT INTO class_students VALUES('COURSE','next','student-b','teacher-a');
        UPDATE class_bonus_rules SET points_acceptance=19 WHERE term_id='next';
        INSERT INTO acceptances VALUES('question','answer','teacher-a',100);
        UPDATE contents SET status='hidden',updated_by='admin' WHERE id='answer';
        UPDATE contents SET status='visible',updated_by='admin' WHERE id='answer';`);
    const history = await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id');
    assert.deepEqual(history.map(r => [r.term_id,r.delta_points]), [['next',19],['next',-19],['current',70]]);
    await db.prepare("DELETE FROM class_students WHERE term_id='next' AND student_id='student-b'").run();
    assert.deepEqual(await rows(db, 'SELECT * FROM bonus_ledger'), [{ ...history[2], reverses_id: null }]);
    await db.prepare("UPDATE contents SET status='hidden',updated_by='admin' WHERE id='answer'").run();
    const last = await db.prepare('SELECT * FROM bonus_ledger ORDER BY id DESC LIMIT 1').first();
    assert.deepEqual([last.term_id,last.delta_points,last.reverses_id], ['current',-70,history[2].id]);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});

test('0012 preserves existing rows and class removal reconciles old detached ledgers atomically', async () => {
    const db = await runtime.getD1Database(`DB${nextDatabase++}`);
    await apply(db, migrations.filter(m => m.name < '0012_'));
    await seed(db);
    await content(db, 'moved', 'question', 'student-a');
    await batch(db, `DELETE FROM class_students WHERE student_id='student-a';
        INSERT INTO class_students VALUES('COURSE','current','student-a','teacher-b');
        INSERT INTO class_students VALUES('COURSE','current','visitor','teacher-a');`);
    await content(db, 'unassigned', 'question', 'visitor');
    await db.prepare("DELETE FROM class_students WHERE student_id='visitor'").run();
    const oldLedger = await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id');
    await apply(db, migrations.filter(m => m.name.startsWith('0012_')));
    assert.deepEqual(await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id'), oldLedger);
    await db.prepare("CREATE TRIGGER test_abort BEFORE DELETE ON class_bonus_rules BEGIN SELECT RAISE(ABORT,'test_rollback'); END").run();
    const remove = db.prepare("DELETE FROM teaching_classes WHERE teacher_id='teacher-a'");
    await assert.rejects(remove.run(), /test_rollback/);
    assert.deepEqual(await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id'), oldLedger);
    await db.prepare('DROP TRIGGER test_abort').run();
    await remove.run();
    assert.deepEqual(await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id'), [{ ...oldLedger[0],teacher_id: 'teacher-b' }]);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});

test('current teachers share content permission but only manage their own current class; former authors retain editing', async () => {
    const binding = await database(); await seed(binding);
    const db = createDatabase(binding), teacherA = { id: 'teacher-a', role: 'teacher' }, teacherB = { id: 'teacher-b', role: 'teacher' };
    const allowed = async expression => Boolean(await db.get(sql`SELECT 1 WHERE ${expression}`));
    for (const teacher of [teacherA, teacherB]) assert.equal(await allowed(management(teacher, sql`'COURSE'`)), true);
    assert.equal(await allowed(classManagement(teacherA, sql`'COURSE'`, sql`'current'`, sql`'teacher-a'`)), true);
    assert.equal(await allowed(classManagement(teacherA, sql`'COURSE'`, sql`'current'`, sql`'teacher-b'`)), false);
    assert.equal(await allowed(classManagement({ id: 'admin', role: 'admin' }, sql`'COURSE'`, sql`'current'`, sql`'teacher-b'`)), true);
    await batch(binding, "UPDATE terms SET current=0; UPDATE terms SET current=1 WHERE id='next';");
    assert.equal(await allowed(management(teacherA, sql`'COURSE'`)), false);
    assert.equal(await allowed(classManagement(teacherA, sql`'COURSE'`, sql`'current'`, sql`'teacher-a'`)), false);
    assert.equal(await allowed(editPermission(teacherA, sql`'teacher-a'`)), true);
    assert.equal(await allowed(editPermission(teacherA, sql`'teacher-b'`)), false);
});

test('teaching class score endpoints isolate class reads and manual adjustments, including idempotent replay', async () => {
    const db = await database(); await seed(db);
    const app = new Hono();
    app.use('*', async (c, next) => { const id = c.req.header('X-Test-Actor'); c.set('actor', { id, role: id === 'admin' ? 'admin' : 'teacher' }); await next(); });
    app.onError((error, c) => c.json({ error: { code: error.code } }, error.status ?? 500));
    app.route('/api', bonusRoutes);
    const request = async (method, path, who, body, key = 'manual-request-01') => {
        const response = await app.request(`/api${path}`, { method, headers: { 'X-Test-Actor': who, 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: body ? JSON.stringify(body) : undefined }, { DB: db });
        return { status: response.status, ...await response.json() };
    };
    const body = { studentId: 'student-b', deltaPoints: 9 };
    assert.equal((await request('POST', '/courses/COURSE/terms/current/teachers/teacher-a/bonus-adjustments', 'teacher-a', body)).status, 409);
    const made = await request('POST', '/courses/COURSE/terms/current/teachers/teacher-b/bonus-adjustments', 'teacher-b', body);
    assert.equal(made.status, 201);
    assert.equal((await request('POST', '/courses/COURSE/terms/current/teachers/teacher-b/bonus-adjustments', 'teacher-b', body)).data.id, made.data.id);
    assert.equal((await request('GET', '/courses/COURSE/terms/current/teachers/teacher-a/bonus-ledger', 'teacher-a')).data.total, 0);
    assert.equal((await request('GET', '/courses/COURSE/terms/current/teachers/teacher-a/bonus-summary', 'teacher-a')).data.total, 0);
    assert.equal((await request('GET', '/courses/COURSE/terms/current/teachers/teacher-b/bonus-ledger', 'teacher-b')).data.total, 1);
    assert.equal((await request('GET', '/courses/COURSE/terms/current/teachers/teacher-b/bonus-ledger', 'admin')).data.total, 1);
    assert.equal(await db.prepare('SELECT teacher_id FROM bonus_ledger').first('teacher_id'), 'teacher-b');
});

const legacyFixture = `PRAGMA defer_foreign_keys=ON; ${identities}
    INSERT INTO terms(id,name,current) VALUES('past','历史',1),('current','当前',0);
    INSERT INTO enrollments VALUES('old-a','past','teacher-a');
    INSERT INTO courses(id,name,code,created_by,updated_by,request_key,request_hash) VALUES('old-a','课程甲','COURSE-A','teacher-a','teacher-a','course-a','hash-a');
    INSERT INTO enrollments VALUES('old-a','past','student-a');
    UPDATE course_bonus_rules SET points_question=3,points_material=11,points_material_version=13 WHERE id='old-a';
    INSERT INTO contents(id,kind,course_id,author_id,title,updated_by,request_key,request_hash) VALUES('old-question','question','old-a','student-a','历史问题','student-a','old-question','hash');
    UPDATE terms SET current=0; UPDATE terms SET current=1 WHERE id='current';
    INSERT INTO enrollments VALUES('old-a','current','teacher-b'),('old-a','current','student-b'),('COURSE-A','current','teacher-a');
    INSERT INTO courses(id,name,code,created_by,updated_by,request_key,request_hash) VALUES('COURSE-A','课程乙','old-a','teacher-a','teacher-a','course-b','hash-b');`;

test('populated upgrade handles swapped course IDs and preserves versions, upload drafts, deleted teachers and ledger chains', async () => {
    const db = await database(true); await batch(db, legacyFixture);
    await batch(db, `INSERT INTO contents(id,kind,course_id,author_id,title,updated_by,request_key,request_hash) VALUES('material','material','old-a','student-b','保留资料','student-b','material','hash');
        INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by) VALUES
            ('material',1,'preserved-object',10,'application/pdf','student-b','student-b'),('material',5,'deleted-object',10,'application/pdf','student-b','student-b');
        DELETE FROM file_versions WHERE version=5;
        INSERT INTO material_upload_sessions(id,owner_id,course_id,material_id,mode,creation_draft,expected_size,mime,status,lease_token,lease_until,put_expires_at,expires_at,created_at,request_key,request_hash)
            VALUES('upload','student-b','old-a','reserved','create','{"title":"原草稿","body":{"type":"doc"}}',10,'application/pdf','confirming','lease',200,100,300,50,'upload-key','upload-hash');
        UPDATE accounts SET status='deleted' WHERE id='teacher-a';`);
    const before = {};
    for (const table of ['accounts','courses','contents','file_versions','material_next_versions','material_upload_sessions','bonus_ledger']) before[table] = await rows(db, `SELECT * FROM ${table}`);
    await apply(db, migrations.filter(migration => migration.name === '0004_teaching_classes.sql'));
    for (const table of ['accounts','file_versions','material_next_versions']) assert.deepEqual(await rows(db, `SELECT * FROM ${table}`), before[table]);
    const remap = old => old === 'old-a' ? 'COURSE-A' : 'old-a';
    for (const table of ['contents','material_upload_sessions']) assert.deepEqual(await rows(db, `SELECT * FROM ${table}`), before[table].map(row => ({ ...row, course_id: remap(row.course_id) })));
    assert.deepEqual(await rows(db, 'SELECT * FROM courses'), before.courses.map(({ code, updated_by, ...row }) => ({ ...row, id: code })));
    assert.deepEqual(await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id'), before.bonus_ledger.map(row => ({ ...row, course_id: remap(row.course_id), teacher_id: row.term_id === 'past' ? 'teacher-a' : 'teacher-b' })));
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM teaching_classes').first('n'), 3);
    assert.equal(await db.prepare("SELECT points_material FROM class_bonus_rules WHERE course_id='COURSE-A' AND term_id='past'").first('points_material'), 11);
    assert.equal(await db.prepare("SELECT teacher_id FROM class_students WHERE course_id='COURSE-A' AND student_id='student-a'").first('teacher_id'), 'teacher-a');
    await db.prepare("UPDATE contents SET status='hidden',updated_by='admin' WHERE id='old-question'").run();
    assert.deepEqual(await db.prepare('SELECT course_id,term_id,teacher_id,delta_points FROM bonus_ledger ORDER BY id DESC LIMIT 1').first(),
        { course_id: 'COURSE-A', term_id: 'past', teacher_id: 'teacher-a', delta_points: -3 });
    assert.deepEqual(await rows(db, "SELECT name FROM sqlite_schema WHERE name LIKE '__academic_%' OR name IN ('enrollments','course_bonus_rules')"), []);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
    assert.deepEqual(await rows(db, 'PRAGMA quick_check'), [{ quick_check: 'ok' }]);
});

test('unresolvable historical class attribution aborts before changing any old data or rules', async () => {
    for (const variant of ['missing-teacher','ambiguous-teacher','missing-rules']) {
        const db = await database(true); await batch(db, legacyFixture);
        if (variant === 'missing-teacher') await db.prepare("DELETE FROM enrollments WHERE term_id='past' AND account_id='student-a'").run();
        if (variant === 'missing-teacher') await db.prepare("DELETE FROM enrollments WHERE term_id='past' AND account_id='teacher-a'").run();
        if (variant === 'ambiguous-teacher') await batch(db, "DROP TRIGGER enrollment_identity_insert; INSERT INTO enrollments VALUES('old-a','past','teacher-b');");
        if (variant === 'missing-rules') await db.prepare("DELETE FROM course_bonus_rules WHERE id='old-a'").run();
        const definitions = await rows(db, "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
        const ledger = await rows(db, 'SELECT * FROM bonus_ledger');
        const memberships = await rows(db, 'SELECT * FROM enrollments');
        await assert.rejects(apply(db, migrations.filter(migration => migration.name === '0004_teaching_classes.sql')), variant === 'missing-rules' ? /academic_legacy_rules_required/ : /academic_unique_legacy_teacher/);
        assert.deepEqual(await rows(db, "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"), definitions);
        assert.deepEqual(await rows(db, 'SELECT * FROM bonus_ledger'), ledger);
        assert.deepEqual(await rows(db, 'SELECT * FROM enrollments'), memberships);
    }
});

test('a failure after data copying rolls back the entire migration, including renamed tables and ledger references', async () => {
    const db = await database(true); await batch(db, legacyFixture);
    const snapshot = async () => ({
        definitions: await rows(db, "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"),
        courses: await rows(db, 'SELECT * FROM courses ORDER BY id'),
        memberships: await rows(db, 'SELECT * FROM enrollments ORDER BY course_id,term_id,account_id'),
        contents: await rows(db, 'SELECT * FROM contents ORDER BY id'),
        ledger: await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id'),
    });
    const before = await snapshot();
    const failing = { statements: [...migrations.find(migration => migration.name === '0004_teaching_classes.sql').statements,
        "INSERT INTO teaching_classes VALUES('COURSE-A','current','student-a');"] };
    await assert.rejects(apply(db, [failing]), /invalid_class_teacher/);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});