import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { generateSQLiteDrizzleJson } from 'drizzle-kit/api';
import * as schema from '../src/db/schema.ts';
import { migrationsDirectory, readMigrations } from './lib/migrations.mjs';

const metaDirectory = new URL('meta/', migrationsDirectory);
const journal = JSON.parse(await readFile(new URL('_journal.json', metaDirectory), 'utf8'));
const migrations = await readMigrations();
assert.equal(journal.dialect, 'sqlite');
assert.ok(journal.entries.length > 0, 'Migration journal must include the legacy baseline.');
assert.deepEqual(
    migrations.map(({ name }) => name),
    journal.entries.map(({ tag }) => `${tag}.sql`),
    'SQL files and the migration journal must have the same entries and order.',
);

let previous;
for (const entry of journal.entries) {
    assert.equal(entry.tag.split('_')[0], String(entry.idx).padStart(4, '0'), 'Migration number must match its journal index.');
    assert.ok(!previous || entry.idx === previous.idx + 1, 'Migration numbers must be consecutive.');
    assert.ok(!previous || entry.when > previous.when, 'Journal timestamps must increase.');
    previous = entry;
}
for (const migration of migrations) {
    assert.ok(migration.statements.length > 0, `${migration.name} is empty.`);
}

const snapshotNames = (await readdir(metaDirectory)).filter((name) => name.endsWith('_snapshot.json')).sort();
const latest = `${String(previous.idx).padStart(4, '0')}_snapshot.json`;
assert.equal(snapshotNames.at(-1), latest, 'The latest migration must have a matching snapshot.');
const snapshot = JSON.parse(await readFile(new URL(latest, metaDirectory), 'utf8'));
const current = JSON.parse(JSON.stringify(await generateSQLiteDrizzleJson(schema)));
// IDs and rename hints describe migration history, not the target database structure.
const structure = ({ id, prevId, _meta, ...value }) => value;
assert.ok(
    isDeepStrictEqual(structure(snapshot), structure(current)),
    'schema.ts differs from the latest snapshot. Run pnpm db:generate --name=<change>, then review and commit its SQL and metadata.',
);

console.log(`Migration history and schema agree (${migrations.length} migrations).`);