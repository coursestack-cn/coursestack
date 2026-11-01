import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

export const migrationsDirectory = new URL('../../migrations/', import.meta.url);
export const metadataDirectory = new URL('meta/', migrationsDirectory);

export function splitMigration(source) {
    return source.split(/--> statement-breakpoint(?:\r?\n|$)/).map((sql) => sql.trim()).filter(Boolean);
}

export async function readMigrations(directory = migrationsDirectory) {
    const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    return Promise.all(names.map(async (name) => ({
        name,
        statements: splitMigration(await readFile(new URL(name, directory), 'utf8')),
    })));
}

export async function readHistory(directory = migrationsDirectory) {
    const meta = new URL('meta/', directory);
    const journal = JSON.parse(await readFile(new URL('_journal.json', meta), 'utf8'));
    assert.equal(journal.dialect, 'sqlite', 'Migration journal must use SQLite.');
    assert.ok(journal.entries.length, 'Migration history must contain the existing baseline.');
    assert.deepEqual((await readMigrations(directory)).map(m => m.name), journal.entries.map(e => `${e.tag}.sql`),
        'SQL files and migration journal differ; do not remove or rename applied migrations.');
    let previousId = '00000000-0000-0000-0000-000000000000';
    const snapshots = [];
    const rules = [];
    for (const [index, entry] of journal.entries.entries()) {
        assert.equal(entry.idx, index, 'Migration journal indexes must be consecutive.');
        assert.match(entry.tag, new RegExp(`^${String(index).padStart(4, '0')}_[a-z][a-z0-9_]*$`), 'Invalid migration name.');
        const prefix = entry.tag.slice(0, 4);
        const snapshot = JSON.parse(await readFile(new URL(`${prefix}_snapshot.json`, meta), 'utf8'));
        assert.equal(snapshot.prevId, previousId, 'Broken migration snapshot chain.');
        assert.equal(snapshot.dialect, 'sqlite');
        assert.equal(snapshot.version, entry.version);
        previousId = snapshot.id;
        snapshots.push(snapshot);
        rules.push(await readFile(new URL(`${prefix}_rules.sql`, meta), 'utf8'));
    }
    return { journal, snapshots, rules };
}