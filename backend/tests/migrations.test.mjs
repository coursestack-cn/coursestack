import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import * as schema from '../src/db/schema.ts';
import { migrationsDirectory, readMigrations, splitMigration } from '../scripts/lib/migrations.mjs';

let runtime;
let migrations;

before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21',
        d1Databases: ['MIGRATED', 'SCHEMA', 'UPGRADE', 'GENERATED', 'ACCOUNT_UPGRADE', 'ACCOUNT_CONFLICT'],
    }));
    migrations = await readMigrations();
});

after(async () => { await runtime?.dispose(); });

async function apply(db, history) {
    for (const { statements } of history) {
        await db.batch(statements.map((sql) => db.prepare(sql)));
    }
}

const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const identifier = (name) => `"${name.replaceAll('"', '""')}"`;
const sorted = (values) => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

async function structure(db) {
    const tables = await rows(db, "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
    return Promise.all(tables.map(async ({ name }) => {
        const columns = await rows(db, `PRAGMA table_info(${identifier(name)})`);
        const singlePrimaryKey = columns.filter((column) => column.pk).length === 1;
        const foreignKeys = await rows(db, `PRAGMA foreign_key_list(${identifier(name)})`);
        const groups = Map.groupBy(foreignKeys, (key) => key.id);
        const indexes = (await rows(db, `PRAGMA index_list(${identifier(name)})`)).filter((index) => index.origin !== 'pk');
        return {
            name,
            columns: sorted(columns.map((column) => ({
                name: column.name,
                type: column.type.toLowerCase(),
                // SQLite's INTEGER PRIMARY KEY is a non-null rowid even without explicit NOT NULL.
                notNull: Boolean(column.notnull || (singlePrimaryKey && column.pk && column.type.toLowerCase() === 'integer')),
                primaryKey: column.pk,
                default: column.dflt_value,
            }))),
            foreignKeys: sorted([...groups.values()].map((group) => group.sort((a, b) => a.seq - b.seq).map(({ id, ...key }) => key))),
            indexes: sorted(await Promise.all(indexes.map(async (index) => {
                const [definition] = await rows(db, `SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = '${index.name.replaceAll("'", "''")}'`);
                const where = definition?.sql?.match(/\bWHERE\s+(.+)$/i)?.[1] ?? null;
                return {
                    name: index.name,
                    unique: index.unique,
                    columns: (await rows(db, `PRAGMA index_xinfo(${identifier(index.name)})`))
                        .filter((column) => column.key).map(({ name, desc, coll }) => ({ name, desc, coll })),
                    where: where?.replaceAll('"', '').replaceAll('`', '').replaceAll(`${name}.`, '').replace(/\s+/g, ''),
                };
            }))),
        };
    }));
}

test('fresh D1 migrations match Drizzle tables, columns, foreign keys and indexes', async () => {
    const migrated = await runtime.getD1Database('MIGRATED');
    const target = await runtime.getD1Database('SCHEMA');
    await apply(migrated, migrations);
    const empty = await generateSQLiteDrizzleJson({});
    const current = await generateSQLiteDrizzleJson(schema);
    const statements = await generateSQLiteMigration(empty, current);
    await target.batch(statements.map((sql) => target.prepare(sql)));
    assert.deepEqual(await structure(migrated), await structure(target));
    assert.deepEqual(await rows(migrated, 'PRAGMA foreign_key_check'), []);
    assert.deepEqual(await rows(migrated, 'SELECT * FROM terms WHERE current=1'), []);
});

test('0005 preserves populated legacy accounts, credentials, profiles and sessions', async () => {
    const db = await runtime.getD1Database('UPGRADE');
    await apply(db, migrations.slice(0, 4));
    await db.batch([
        "INSERT INTO accounts (id, public_name) VALUES ('admin', 'Administrator'), ('student', 'Student'), ('other', 'Other')",
        "INSERT INTO account_roles VALUES ('admin', 'admin'), ('student', 'student'), ('other', 'teacher')",
        "INSERT INTO student_records (account_id, student_number, real_name) VALUES ('student', '00123', 'Fictional Student')",
        "INSERT INTO credentials VALUES ('admin', NULL, 'fictional-admin-hash', 3), ('student', '00123', 'fictional-student-hash', 7)",
        "INSERT INTO account_private VALUES ('admin', NULL, NULL), ('student', 'Fictional Student', 'student@example.test')",
        "INSERT INTO sessions VALUES ('fictional-token-digest', 'student', 7, 2000000000)",
    ].map((sql) => db.prepare(sql)));
    const tables = ['accounts', 'account_roles', 'student_records', 'credentials', 'account_private', 'sessions'];
    const before = await Promise.all(tables.map((table) => rows(db, `SELECT * FROM ${table} ORDER BY 1`)));
    await apply(db, [migrations.find(({ name }) => name === '0005_align_unique_indexes.sql')]);
    const after = await Promise.all(tables.map((table) => rows(db, `SELECT * FROM ${table} ORDER BY 1`)));
    assert.deepEqual(after, before);
    await assert.rejects(db.prepare("INSERT INTO credentials VALUES ('other', '00123', 'fictional-hash', 1)").run(), /UNIQUE constraint/i);
    await assert.rejects(db.prepare("INSERT INTO account_private VALUES ('other', NULL, 'student@example.test')").run(), /UNIQUE constraint/i);
    await assert.rejects(db.prepare("UPDATE credentials SET version = 0 WHERE account_id = 'student'").run(), /CHECK constraint/i);
    await db.batch([
        db.prepare("INSERT INTO credentials VALUES ('other', NULL, 'fictional-hash', 1)"),
        db.prepare("INSERT INTO account_private VALUES ('other', NULL, NULL)"),
    ]);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});

test('the adopted snapshot generates an additive migration that preserves existing data', async () => {
    const db = await runtime.getD1Database('GENERATED');
    await apply(db, migrations);
    await db.batch([
        'PRAGMA defer_foreign_keys=ON',
        "INSERT INTO accounts(id,nickname,role) VALUES ('teacher','Teacher','teacher')",
        "INSERT INTO terms(id,name,current) VALUES ('current','Current term',1)",
        "INSERT INTO enrollments VALUES ('existing','current','teacher')",
        "INSERT INTO courses (id, name) VALUES ('existing', 'Existing course')",
    ].map(s => db.prepare(s)));
    const journal = JSON.parse(await readFile(new URL('meta/_journal.json', migrationsDirectory), 'utf8'));
    const prefix = String(journal.entries.at(-1).idx).padStart(4, '0');
    const previous = JSON.parse(await readFile(new URL(`meta/${prefix}_snapshot.json`, migrationsDirectory), 'utf8'));
    const next = structuredClone(previous);
    next.id = crypto.randomUUID();
    next.prevId = previous.id;
    next.tables.courses.columns.migration_probe = {
        name: 'migration_probe', type: 'text', primaryKey: false, notNull: false, autoincrement: false,
    };
    const generated = await generateSQLiteMigration(previous, next);
    assert.equal(generated.length, 1);
    assert.match(generated[0], /^ALTER TABLE/i);
    const statements = splitMigration(generated.join('--> statement-breakpoint\n'));
    await db.batch(statements.map((sql) => db.prepare(sql)));
    assert.deepEqual(await rows(db, "SELECT id, name, migration_probe FROM courses WHERE id = 'existing'"), [
        { id: 'existing', name: 'Existing course', migration_probe: null },
    ]);
});

test('migration loading accepts legacy and generated inline statement markers', () => {
    assert.deepEqual(splitMigration('SELECT 1;\n-- statement-breakpoint\nSELECT 2;--> statement-breakpoint\r\nSELECT 3;'), [
        'SELECT 1;', 'SELECT 2;', 'SELECT 3;',
    ]);
});

test('0010 consolidates populated accounts without changing IDs, credentials, sessions or business history', async () => {
    const db = await runtime.getD1Database('ACCOUNT_UPGRADE');
    await apply(db, migrations.slice(0, migrations.findIndex(m => m.name === '0010_consolidate_accounts.sql')));
    await db.batch([
        "INSERT INTO accounts(id,public_name,status,revision,avatar_key,created_at,last_login_at) VALUES ('student','公开昵称','disabled',9,'avatars/old',100,200),('teacher','教师昵称','active',2,NULL,100,NULL),('unprovisioned','未开通','active',1,NULL,100,NULL)",
        "INSERT INTO account_roles VALUES ('student','student'),('teacher','teacher'),('unprovisioned','student')",
        "INSERT INTO credentials(account_id,school_number,password_hash,version,must_change_password) VALUES ('student','00001','fictional-hash',7,1),('teacher','T001','fictional-teacher-hash',3,0)",
        "INSERT INTO student_records(account_id,student_number,real_name) VALUES ('student','00001','姓名甲'),('unprovisioned','00002','姓名乙')",
        "INSERT INTO account_private(account_id,real_name,email) VALUES ('student','姓名甲','fictional@example.test'),('teacher','教师姓名',NULL)",
        "INSERT INTO sessions VALUES ('fictional-token','student',7,2000000000)",
        "INSERT INTO terms VALUES ('past','历史学期'),('current','当前学期')",
        "UPDATE academic_settings SET current_term_id='current' WHERE id=1",
        "INSERT INTO courses(id,name,created_by,updated_by) VALUES ('course','保留课程','teacher','teacher')",
        "INSERT INTO teaching_assignments(course_id,term_id,teacher_id) VALUES ('course','past','teacher'),('course','current','teacher')",
        "INSERT INTO enrollments(course_id,term_id,student_id) VALUES ('course','past','student'),('course','current','student')",
        "INSERT INTO contents(id,kind,course_id,author_id,title,body,updated_by,request_key,request_hash) VALUES ('question','question','course','student','保留问题','保留正文','student','fixture-question','fictional-request-hash')",
        "INSERT INTO votes(content_id,user_id,value) VALUES ('question','teacher',1)",
        "INSERT INTO account_audit(id,actor_id,target_id,action,fields) VALUES ('audit','teacher','student','profile.update','[\"publicName\"]')",
        "INSERT INTO avatar_objects(object_key) VALUES ('avatars/old')",
    ].map(sql => db.prepare(sql)));
    const preserved = ['sessions', 'courses', 'terms', 'academic_settings', 'contents', 'votes', 'account_audit', 'business_events'];
    const before = await Promise.all(preserved.map(table => rows(db, `SELECT * FROM ${table} ORDER BY rowid`)));
    const memberships = await rows(db, 'SELECT course_id,term_id,student_id,created_at FROM enrollments ORDER BY term_id');
    await apply(db, [migrations.find(m => m.name === '0010_consolidate_accounts.sql')]);
    assert.deepEqual(await Promise.all(preserved.map(table => rows(db, `SELECT * FROM ${table} ORDER BY rowid`))), before);
    assert.deepEqual(await rows(db, 'SELECT * FROM enrollments ORDER BY term_id'), memberships);
    assert.deepEqual(await db.prepare("SELECT id,nickname,role,status,school_number,password,must_change_password,credential_version,data_generation,name,department,major,grade,created_at,last_login_at,avatar_key FROM accounts WHERE id='student'").first(), {
        id: 'student', nickname: '公开昵称', role: 'student', status: 'disabled', school_number: '00001', password: 'fictional-hash',
        must_change_password: 1, credential_version: 7, data_generation: 1, name: '姓名甲', department: null, major: null, grade: null,
        created_at: 100, last_login_at: 200, avatar_key: 'avatars/old',
    });
    assert.deepEqual(await db.prepare("SELECT school_number,name,password FROM accounts WHERE id='unprovisioned'").first(), { school_number: '00002', name: '姓名乙', password: null });
    const tables = (await rows(db, "SELECT name FROM sqlite_schema WHERE type='table'")).map(r => r.name);
    for (const removed of ['account_roles', 'student_records', 'credentials', 'account_private', 'avatar_objects']) assert.ok(!tables.includes(removed), removed);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});

test('0010 refuses conflicting legacy basic information and rolls back the entire migration', async () => {
    const db = await runtime.getD1Database('ACCOUNT_CONFLICT');
    await apply(db, migrations.slice(0, migrations.findIndex(m => m.name === '0010_consolidate_accounts.sql')));
    await db.batch([
        "INSERT INTO accounts(id,public_name) VALUES ('student','昵称')",
        "INSERT INTO account_roles VALUES ('student','student')",
        "INSERT INTO credentials(account_id,school_number,password_hash) VALUES ('student','001','fictional-hash')",
        "INSERT INTO student_records(account_id,student_number,real_name) VALUES ('student','001','姓名甲')",
        "INSERT INTO account_private(account_id,real_name) VALUES ('student','不同姓名')",
    ].map(sql => db.prepare(sql)));
    for (const conflict of ['name', 'number', 'missing role']) {
        if (conflict === 'number') await db.batch([
            db.prepare("UPDATE account_private SET real_name='姓名甲'"), db.prepare("UPDATE credentials SET school_number='002'"),
        ]);
        if (conflict === 'missing role') await db.batch([
            db.prepare('DELETE FROM student_records'), db.prepare('DELETE FROM account_roles'),
        ]);
        const before = await structure(db);
        await assert.rejects(apply(db, [migrations.find(m => m.name === '0010_consolidate_accounts.sql')]), /account_identity_merge_conflict/);
        assert.deepEqual(await structure(db), before);
        assert.equal(await db.prepare("SELECT public_name FROM accounts WHERE id='student'").first('public_name'), '昵称');
        assert.equal(await db.prepare("SELECT password_hash FROM credentials WHERE account_id='student'").first('password_hash'), 'fictional-hash');
    }
});