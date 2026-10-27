import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import * as schema from '../src/db/schema.ts';
import { readMigrations, splitMigration } from '../scripts/lib/migrations.mjs';

let runtime;
let migrations;

before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21',
        d1Databases: ['MIGRATED', 'SCHEMA'],
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

test('fresh D1 initialization makes every application table STRICT and matches Drizzle structure', async () => {
    const migrated = await runtime.getD1Database('MIGRATED');
    const target = await runtime.getD1Database('SCHEMA');
    await apply(migrated, migrations);
    const empty = await generateSQLiteDrizzleJson({});
    const current = await generateSQLiteDrizzleJson(schema);
    const statements = await generateSQLiteMigration(empty, current);
    await target.batch(statements.map((sql) => target.prepare(sql)));
    const expected = await structure(target);
    assert.equal(expected.some(table => table.name === 'business_events'), false);
    for (const table of expected) assert.equal(table.columns.some(column => column.name === 'revision'), false, table.name);
    assert.deepEqual(await structure(migrated), expected);
    const tableModes = new Map((await rows(migrated, 'PRAGMA table_list'))
        .filter(table => table.schema === 'main').map(table => [table.name, table.strict]));
    for (const { name } of expected) assert.equal(tableModes.get(name), 1, `${name} must be STRICT`);
    assert.deepEqual(await rows(migrated, 'PRAGMA foreign_key_check'), []);
    assert.deepEqual(await rows(migrated, 'SELECT * FROM terms WHERE current=1'), []);
});

test('SQL statement markers preserve trigger bodies containing semicolons', () => {
    assert.deepEqual(splitMigration('SELECT 1;--> statement-breakpoint\nCREATE TRIGGER example AFTER INSERT ON items BEGIN SELECT 2; SELECT 3; END;'), [
        'SELECT 1;', 'CREATE TRIGGER example AFTER INSERT ON items BEGIN SELECT 2; SELECT 3; END;',
    ]);
});

test('current rows require course identity, actors, timestamps and creation request identity', async () => {
    const db = await runtime.getD1Database('MIGRATED');
    const seed = await readFile(new URL('../seed/local.sql', import.meta.url), 'utf8');
    await db.batch(seed.split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
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

    const file = db.prepare(`INSERT INTO file_versions(material_id,version,filename,uploaded_by,updated_by)
        VALUES('demo-material',?,'测试.pdf','demo-teacher','demo-teacher')`);
    await assert.rejects(file.bind(1.5).run(), /cannot store REAL value in INTEGER column file_versions.version/);
    await assert.rejects(file.bind(0).run(), /file_versions_version/);
    await assert.rejects(db.prepare(`INSERT INTO bonus_ledger(course_id,term_id,student_id,delta_points,source_kind,source_id,operator_id,reason,request_hash)
        VALUES('demo-course','demo-current','demo-student',1.5,'manual','strict-test','demo-teacher','测试','strict-test')`).run(),
        /cannot store REAL value in INTEGER column bonus_ledger.delta_points/);
    await assert.rejects(db.prepare("UPDATE contents SET status='invalid' WHERE id='demo-material'").run(), /contents_status/);
    await assert.rejects(db.prepare("UPDATE contents SET body='invalid JSON' WHERE id='demo-material'").run(), /contents_body_json/);
    assert.deepEqual(await rows(db, 'PRAGMA quick_check'), [{ quick_check: 'ok' }]);
});