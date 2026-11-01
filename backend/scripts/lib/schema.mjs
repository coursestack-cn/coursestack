import { readFile } from 'node:fs/promises';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import * as schema from '../../src/db/schema.ts';
import { splitMigration } from './migrations.mjs';

export const rulesFile = new URL('../../src/db/rules.sql', import.meta.url);

export const generateSnapshot = (previousId) => generateSQLiteDrizzleJson(schema, previousId);
export const snapshotModel = ({ id, prevId, ...model }) => JSON.parse(JSON.stringify(model));

export function strictStatements(statements) {
    // The installed Drizzle version has no STRICT table option; enforce it for every generated table.
    return statements.map(sql => {
        if (!/^CREATE TABLE\b/i.test(sql.trimStart())) return sql;
        if (!/\);\s*$/.test(sql)) throw new Error('Unexpected CREATE TABLE format; cannot apply STRICT.');
        return sql.replace(/\);\s*$/, ') STRICT;');
    });
}

export const joinStatements = (statements) => statements.map(sql => sql.trim()).join('\n--> statement-breakpoint\n');
export const readRules = async () => joinStatements(splitMigration(await readFile(rulesFile, 'utf8')));

// Used only as an independent target for migration tests; never overwrites migration history.
export async function generateSchema() {
    const empty = await generateSQLiteDrizzleJson({});
    const current = await generateSnapshot();
    return joinStatements([
        ...strictStatements(await generateSQLiteMigration(empty, current)),
        ...splitMigration(await readRules()),
    ]);
}