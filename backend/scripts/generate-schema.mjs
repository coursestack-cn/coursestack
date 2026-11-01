import { writeFile } from 'node:fs/promises';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { generateSQLiteMigration } from 'drizzle-kit/api';
import { generateSnapshot, joinStatements, readRules, snapshotModel, strictStatements } from './lib/schema.mjs';
import { metadataDirectory, migrationsDirectory, readHistory, splitMigration } from './lib/migrations.mjs';

const { values } = parseArgs({ options: { name: { type: 'string', default: 'schema' } } });
if (!/^[a-z][a-z0-9_]*$/.test(values.name)) throw new Error('Use --name <lowercase_name> without a number prefix.');
const { journal, snapshots, rules } = await readHistory();
const previous = snapshots.at(-1);
const current = await generateSnapshot(previous.id);
const currentRules = await readRules();
const previousRules = joinStatements(splitMigration(rules.at(-1)));
if (isDeepStrictEqual(snapshotModel(previous), snapshotModel(current)) && previousRules === currentRules) {
    console.log('No schema or rule changes. Migration history was not modified.');
} else {
    // D1 always enforces foreign keys. Deferral lasts until the migration transaction commits.
    const changes = strictStatements(await generateSQLiteMigration(previous, current))
        .filter(sql => !/^PRAGMA\s+foreign_keys\s*=/i.test(sql.trim()));
    // Rebuilds can invalidate views and remove table triggers. Reinstall rules after copying data.
    const drops = splitMigration(previousRules).reverse().map(sql => {
        const match = /\bCREATE\s+(VIEW|TRIGGER)\s+([a-z][a-z0-9_]*)\b/i.exec(sql);
        if (!match) throw new Error('rules.sql may contain only named CREATE VIEW / CREATE TRIGGER statements.');
        return `DROP ${match[1]} IF EXISTS "${match[2]}";`;
    });
    const prefix = String(journal.entries.length).padStart(4, '0');
    const tag = `${prefix}_${values.name}`;
    const source = '-- Review data copies, required-column backfills and foreign-key actions before applying.\n'
        + joinStatements(['PRAGMA defer_foreign_keys=ON;', ...drops, ...changes, ...splitMigration(currentRules)]);
    // Exclusive creation prevents a name collision from overwriting an existing migration.
    await writeFile(new URL(`${tag}.sql`, migrationsDirectory), source, { flag: 'wx' });
    await writeFile(new URL(`${prefix}_snapshot.json`, metadataDirectory), JSON.stringify(current, null, 2), { flag: 'wx' });
    await writeFile(new URL(`${prefix}_rules.sql`, metadataDirectory), currentRules, { flag: 'wx' });
    journal.entries.push({ idx: journal.entries.length, version: current.version, when: Date.now(), tag, breakpoints: true });
    await writeFile(new URL('_journal.json', metadataDirectory), JSON.stringify(journal, null, 2));
    console.log(`Generated migrations/${tag}.sql and metadata. Review the SQL before applying; no database was modified.`);
}