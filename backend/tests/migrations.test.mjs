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

test('fresh D1 initialization matches Drizzle tables, columns, foreign keys and indexes', async () => {
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
    assert.equal(await db.prepare("SELECT count(*) AS n FROM business_events WHERE event_id='course:demo-course:1'").first('n'), 1);
});