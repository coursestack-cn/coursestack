import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readMigrations, splitMigration } from '../scripts/lib/migrations.mjs';
import { generateSchema } from '../scripts/lib/schema.mjs';

let runtime;
let migrations;

before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21',
        d1Databases: ['MIGRATED', 'SCHEMA', 'UPGRADED', 'GUARDED', 'RENAMED', 'VERSION_CONTRACT', 'HIDDEN_VERSION_GUARD'],
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

// Minimal rows for constraint checks; the teacher enrollment must precede the course.
const fixture = `PRAGMA defer_foreign_keys=ON;
INSERT INTO accounts (id, nickname, role, school_number, name) VALUES
    ('demo-teacher', '演示教师', 'teacher', 'DEMO-T01', NULL), ('demo-student', '演示同学', 'student', 'DEMO-001', '虚构学生甲');
INSERT INTO terms (id, name, current) VALUES ('demo-current', '演示当前学期', 1);
INSERT INTO enrollments (course_id, term_id, account_id) VALUES ('demo-course', 'demo-current', 'demo-teacher');
INSERT INTO courses (id, name, code, created_by, updated_by, request_key, request_hash)
VALUES ('demo-course', '演示课程', 'DEMO-COURSE', 'demo-teacher', 'demo-teacher', 'fixture-course', 'fixture-course');
INSERT INTO contents (id, kind, course_id, author_id, title, updated_by, request_key, request_hash)
VALUES ('demo-material', 'material', 'demo-course', 'demo-teacher', '演示讲义', 'demo-teacher', 'fixture-material', 'fixture-material');`;

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

// Preserve quoted SQL values while ignoring identifier quoting and layout changed by ALTER TABLE.
const normalizedSql = sql => sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|[^\s'"`]+/g)
    .map(token => /^["`]/.test(token) ? token.slice(1, -1) : token).join('');
async function definitions(db) {
    return (await rows(db, `SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL
        AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY type,name`))
        .map(row => ({ ...row, sql: normalizedSql(row.sql) }));
}

test('complete migration history initializes STRICT tables and matches current columns, constraints, views and triggers', async () => {
    const migrated = await runtime.getD1Database('MIGRATED');
    const target = await runtime.getD1Database('SCHEMA');
    await apply(migrated, migrations);
    const statements = splitMigration(await generateSchema());
    await target.batch(statements.map((sql) => target.prepare(sql)));
    const expected = await structure(target);
    assert.equal(expected.some(table => table.name === 'business_events'), false);
    assert.equal(expected.find(table => table.name === 'contents').columns.some(column => column.name === 'target_kind'), false);
    for (const table of expected) assert.equal(table.columns.some(column => column.name === 'revision'), false, table.name);
    assert.deepEqual(await structure(migrated), expected);
    assert.deepEqual(await definitions(migrated), await definitions(target));
    const tableModes = new Map((await rows(migrated, 'PRAGMA table_list'))
        .filter(table => table.schema === 'main').map(table => [table.name, table.strict]));
    for (const { name } of expected) assert.equal(tableModes.get(name), 1, `${name} must be STRICT`);
    assert.deepEqual(await rows(migrated, 'PRAGMA foreign_key_check'), []);
    assert.deepEqual(await rows(migrated, 'SELECT * FROM terms WHERE current=1'), []);
});

test('upgrading the baseline preserves accounts, sessions, courses, discussions, votes, acceptance and points', async () => {
    const db = await runtime.getD1Database('UPGRADED');
    await apply(db, migrations.slice(0, 1));
    await db.batch(fixture.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
    const existing = `
        INSERT INTO accounts(id,nickname,role,password) VALUES('demo-admin','管理员','admin','preserved-password-hash');
        INSERT INTO sessions(token_hash,account_id,credential_version,expires_at) VALUES('preserved-session','demo-admin',1,9999999999);
        INSERT INTO enrollments(course_id,term_id,account_id) VALUES('demo-course','demo-current','demo-student');
        UPDATE course_bonus_rules SET points_question=5,points_answer=2,points_acceptance=3,points_material=7 WHERE id='demo-course';
        INSERT INTO contents(id,kind,course_id,author_id,title,body,updated_by,request_key,request_hash)
          VALUES('existing-question','question','demo-course','demo-student','旧问题','{"type":"doc"}','demo-student','existing-question','fixture');
        INSERT INTO contents(id,kind,course_id,author_id,target_id,body,updated_by,request_key,request_hash) VALUES
          ('existing-answer','answer','demo-course','demo-student','existing-question','{"type":"doc"}','demo-student','existing-answer','fixture'),
          ('existing-comment','comment','demo-course','demo-teacher','existing-question','{"type":"doc"}','demo-teacher','existing-comment','fixture');
        INSERT INTO votes(content_id,user_id,value) VALUES('existing-question','demo-teacher',1);
        INSERT INTO acceptances(question_id,answer_id,operator_id) VALUES('existing-question','existing-answer','demo-teacher');`;
    await db.batch(existing.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
    const tables = await rows(db, "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name");
    const before = new Map(await Promise.all(tables.map(async ({ name }) => [name, sorted(await rows(db, `SELECT * FROM ${identifier(name)}`))])));
    assert.ok(before.get('bonus_ledger').length > 0);
    await apply(db, migrations.slice(1));
    for (const [name, records] of before) assert.deepEqual(sorted(await rows(db, `SELECT * FROM ${identifier(name)}`)), records, name);
    assert.deepEqual(await definitions(db), await definitions(await runtime.getD1Database('SCHEMA')));
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);

    // Newly installed file triggers must work after an upgrade without replaying historical awards.
    await db.prepare(`INSERT INTO contents(id,kind,course_id,author_id,title,updated_by,request_key,request_hash)
        VALUES('new-material','material','demo-course','demo-student','讲义.pdf','demo-student','new-material','fixture')`).run();
    await db.prepare(`INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by)
        VALUES('new-material',1,'new-material-object',8,'application/pdf','demo-student','demo-student')`).run();
    assert.equal(await db.prepare("SELECT next_version FROM material_next_versions WHERE material_id='new-material'").first('next_version'), 2);
    assert.equal(await db.prepare("SELECT delta_points FROM bonus_ledger WHERE source_kind='material' AND source_id='new-material@1'").first('delta_points'), 7);
    assert.deepEqual(await rows(db, 'PRAGMA quick_check'), [{ quick_check: 'ok' }]);
});

test('unexpected legacy file versions abort the upgrade and roll back schema and business records', async () => {
    const db = await runtime.getD1Database('GUARDED');
    await apply(db, migrations.slice(0, 1));
    await db.batch(fixture.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
    await db.prepare(`INSERT INTO file_versions(material_id,version,filename,uploaded_by,updated_by)
        VALUES('demo-material',1,'preserved-legacy.pdf','demo-teacher','demo-teacher')`).run();
    const before = await definitions(db);
    const files = await rows(db, 'SELECT * FROM file_versions');
    await assert.rejects(apply(db, migrations.slice(1)), /materials_require_empty_file_versions/);
    assert.deepEqual(await definitions(db), before);
    assert.deepEqual(await rows(db, 'SELECT * FROM file_versions'), files);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});

test('SQL statement markers preserve trigger bodies containing semicolons', () => {
    assert.deepEqual(splitMigration('SELECT 1;--> statement-breakpoint\nCREATE TRIGGER example AFTER INSERT ON items BEGIN SELECT 2; SELECT 3; END;'), [
        'SELECT 1;', 'CREATE TRIGGER example AFTER INSERT ON items BEGIN SELECT 2; SELECT 3; END;',
    ]);
});

test('current rows require course identity, actors, timestamps and creation request identity', async () => {
    const db = await runtime.getD1Database('MIGRATED');
    await db.batch(fixture.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
    for (const field of ['code', 'created_by', 'updated_by', 'updated_at', 'request_key', 'request_hash']) {
        await assert.rejects(db.prepare(`UPDATE courses SET ${field}=NULL WHERE id='demo-course'`).run(), /NOT NULL constraint/);
    }
    await assert.rejects(db.prepare("UPDATE courses SET code='' WHERE id='demo-course'").run(), /courses_code/);
    for (const field of ['request_key', 'request_hash']) {
        await assert.rejects(db.prepare(`UPDATE contents SET ${field}=NULL WHERE id='demo-material'`).run(), /NOT NULL constraint/);
    }
});

test('STRICT enforces storage types while preserving nullable values, lossless conversion and business checks', async () => {
    const db = await runtime.getD1Database('MIGRATED');
    for (const value of [1.5, 'invalid']) {
        await assert.rejects(db.prepare("UPDATE accounts SET last_login_at=? WHERE id='demo-student'").bind(value).run(),
            /cannot store (REAL|TEXT) value in INTEGER column accounts.last_login_at/);
    }
    await assert.rejects(db.prepare("UPDATE accounts SET nickname=x'6162' WHERE id='demo-student'").run(),
        /cannot store BLOB value in TEXT column accounts.nickname/);
    await db.prepare("UPDATE accounts SET last_login_at='123' WHERE id='demo-student'").run();
    assert.deepEqual(await db.prepare("SELECT last_login_at AS value,typeof(last_login_at) AS type FROM accounts WHERE id='demo-student'").first(),
        { value: 123, type: 'integer' });
    await db.prepare("UPDATE accounts SET last_login_at=NULL WHERE id='demo-student'").run();
    assert.equal(await db.prepare("SELECT last_login_at FROM accounts WHERE id='demo-student'").first('last_login_at'), null);

    const file = db.prepare(`INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by)
        VALUES('demo-material',?,'fixture-file',8,'application/pdf','demo-teacher','demo-teacher')`);
    await assert.rejects(file.bind(1.5).run(), /cannot store REAL value in INTEGER column file_versions.version/);
    await assert.rejects(file.bind(0).run(), /file_versions_version/);
    await assert.rejects(db.prepare(`INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,reason,request_hash)
        VALUES('demo-course','demo-current','demo-student',1.5,'manual','strict-test','demo-teacher','测试','strict-test')`).run(),
        /cannot store REAL value in INTEGER column bonus_ledger.delta_points/);
    await assert.rejects(db.prepare("UPDATE contents SET status='invalid' WHERE id='demo-material'").run(), /contents_status/);
    await assert.rejects(db.prepare("UPDATE contents SET body='invalid JSON' WHERE id='demo-material'").run(), /contents_body_json/);
    assert.deepEqual(await rows(db, 'PRAGMA quick_check'), [{ quick_check: 'ok' }]);
});

test('material table renames preserve upload sessions, version allocation and file history', async () => {
    const db = await runtime.getD1Database('RENAMED');
    const renameIndex = migrations.findIndex(migration => migration.name === '0002_material_table_names.sql');
    assert.ok(renameIndex > 0);
    await apply(db, migrations.slice(0, renameIndex));
    await db.batch(fixture.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
    await db.batch([
        db.prepare(`INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by)
            VALUES('demo-material',1,'kept-object',8,'application/pdf','demo-teacher','demo-teacher'),
                ('demo-material',5,'removed-object',8,'application/pdf','demo-teacher','demo-teacher')`),
        db.prepare("DELETE FROM file_versions WHERE material_id='demo-material' AND version=5"),
        db.prepare(`INSERT INTO file_version_actions(material_id,version,actor_id,old_status,new_status,reason,created_at)
            VALUES('demo-material',5,'demo-teacher','visible','hidden','kept reason',100)`),
    ]);
    for (const [index, status] of ['pending', 'confirming', 'published', 'cancelled', 'expired'].entries()) {
        await db.prepare(`INSERT INTO material_uploads(id,owner_id,course_id,material_id,mode,payload,expected_size,mime,change_note,
            status,result_version,lease_token,lease_until,put_expires_at,expires_at,created_at,cleaned_at,request_key,request_hash)
            VALUES(?,'demo-teacher','demo-course','demo-material','version',NULL,8,'application/pdf','kept note',?,?,?,?,200,300,100,?,?,?)`)
            .bind(`kept-${status}`, status, status === 'published' ? 1 : null,
                status === 'confirming' ? 'kept-lease' : null, status === 'confirming' ? 250 : null,
                index > 2 ? 400 : null, `kept-key-${status}`, `kept-hash-${status}`).run();
    }
    await db.prepare(`INSERT INTO material_uploads(id,owner_id,course_id,material_id,mode,payload,expected_size,mime,
        put_expires_at,expires_at,created_at,request_key,request_hash)
        VALUES('kept-draft','demo-teacher','demo-course','reserved-material','create',?,8,'application/pdf',200,300,100,'kept-draft','kept-hash')`)
        .bind(JSON.stringify({ title: 'draft.pdf', body: { type: 'doc' }, tags: ['kept'] })).run();
    const sessions = await rows(db, 'SELECT * FROM material_uploads ORDER BY id');
    const versions = await rows(db, 'SELECT * FROM material_counters ORDER BY material_id');
    const files = await rows(db, 'SELECT * FROM file_versions');
    const actions = await rows(db, 'SELECT * FROM file_version_actions');
    await apply(db, migrations.slice(renameIndex, renameIndex + 1));
    assert.deepEqual(await rows(db, 'SELECT * FROM material_upload_sessions ORDER BY id'), sessions);
    assert.deepEqual(await rows(db, 'SELECT * FROM material_next_versions ORDER BY material_id'), versions);
    assert.deepEqual(await rows(db, 'SELECT * FROM file_versions'), files);
    assert.deepEqual(await rows(db, 'SELECT * FROM file_version_actions'), actions);
    assert.deepEqual(await rows(db, "SELECT name FROM sqlite_schema WHERE name IN ('material_uploads','material_counters')"), []);
    await assert.rejects(db.prepare("INSERT INTO material_upload_sessions SELECT 'duplicate',owner_id,course_id,material_id,mode,payload,expected_size,mime,change_note,status,result_version,lease_token,lease_until,put_expires_at,expires_at,created_at,cleaned_at,request_key,request_hash FROM material_upload_sessions WHERE id='kept-pending'").run(), /UNIQUE/);
    assert.equal(await db.prepare("SELECT next_version FROM material_next_versions WHERE material_id='demo-material'").first('next_version'), 6);
    await db.prepare(`INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by)
        SELECT material_id,next_version,'next-object',8,'application/pdf','demo-teacher','demo-teacher'
        FROM material_next_versions WHERE material_id='demo-material'`).run();
    assert.equal(await db.prepare("SELECT next_version FROM material_next_versions WHERE material_id='demo-material'").first('next_version'), 7);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});

test('the version contract migration preserves creation drafts, files, counters and points', async () => {
    const db = await runtime.getD1Database('VERSION_CONTRACT');
    const contractIndex = migrations.findIndex(migration => migration.name === '0003_material_version_contract.sql');
    assert.ok(contractIndex > 0);
    await apply(db, migrations.slice(0, contractIndex));
    await db.batch(fixture.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
    await db.batch([
        db.prepare("INSERT INTO enrollments(course_id,term_id,account_id) VALUES('demo-course','demo-current','demo-student')"),
        db.prepare("UPDATE course_bonus_rules SET points_material=7,points_material_version=2 WHERE id='demo-course'"),
        db.prepare(`INSERT INTO file_versions(material_id,version,storage_key,size,mime,change_note,uploaded_by,updated_by)
            VALUES('demo-material',1,'preserved-file',8,'application/pdf','removed note','demo-student','demo-student'),
                ('demo-material',3,'deleted-file',8,'application/pdf','removed note','demo-student','demo-student')`),
        db.prepare("DELETE FROM file_versions WHERE material_id='demo-material' AND version=3"),
    ]);
    const draft = JSON.stringify({ title: 'draft.pdf', body: { type: 'doc' }, tags: ['keep'] });
    await db.prepare(`INSERT INTO material_upload_sessions(id,owner_id,course_id,material_id,mode,payload,expected_size,mime,change_note,
        put_expires_at,expires_at,created_at,request_key,request_hash)
        VALUES('kept-draft','demo-student','demo-course','reserved-material','create',?,8,'application/pdf','removed note',200,300,100,'kept-key','kept-hash')`).bind(draft).run();
    await db.prepare(`INSERT INTO file_version_actions(material_id,version,actor_id,old_status,new_status,reason,created_at)
        VALUES('demo-material',3,'demo-teacher','visible','hidden','obsolete action',100)`).run();
    const ledger = await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id');
    const versions = await rows(db, 'SELECT material_id,version,storage_key,size,mime,uploaded_by,updated_by,created_at FROM file_versions');
    const sessions = (await rows(db, 'SELECT * FROM material_upload_sessions')).map(({ payload, change_note, ...row }) => ({ ...row, creation_draft: payload }));
    const counters = await rows(db, 'SELECT * FROM material_next_versions');
    await apply(db, migrations.slice(contractIndex));
    assert.deepEqual(await rows(db, 'SELECT * FROM file_versions'), versions);
    assert.deepEqual(await rows(db, 'SELECT * FROM material_upload_sessions'), sessions);
    assert.deepEqual(await rows(db, 'SELECT * FROM material_next_versions'), counters);
    assert.deepEqual(await rows(db, 'SELECT * FROM bonus_ledger ORDER BY id'), ledger);
    assert.deepEqual(await rows(db, "SELECT name FROM sqlite_schema WHERE name IN ('file_version_actions','file_version_status_bonus')"), []);
    await assert.rejects(db.prepare("UPDATE material_upload_sessions SET creation_draft='invalid-json'").run(), /material_upload_sessions_creation_draft/);
    await db.prepare(`INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by)
        SELECT material_id,next_version,'next-file',8,'application/pdf','demo-student','demo-student'
        FROM material_next_versions WHERE material_id='demo-material'`).run();
    assert.equal(await db.prepare("SELECT next_version FROM material_next_versions WHERE material_id='demo-material'").first('next_version'), 5);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});

test('removing version visibility cannot silently publish legacy hidden files', async () => {
    const db = await runtime.getD1Database('HIDDEN_VERSION_GUARD');
    const contractIndex = migrations.findIndex(migration => migration.name === '0003_material_version_contract.sql');
    await apply(db, migrations.slice(0, contractIndex));
    await db.batch(fixture.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
    await db.prepare(`INSERT INTO file_versions(material_id,version,storage_key,size,mime,status,uploaded_by,updated_by)
        VALUES('demo-material',1,'hidden-file',8,'application/pdf','hidden','demo-teacher','demo-teacher')`).run();
    const definition = await definitions(db), versions = await rows(db, 'SELECT * FROM file_versions');
    await assert.rejects(apply(db, migrations.slice(contractIndex)), /material_versions_require_no_hidden_rows/);
    assert.deepEqual(await definitions(db), definition);
    assert.deepEqual(await rows(db, 'SELECT * FROM file_versions'), versions);
    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});