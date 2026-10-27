import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { baselineFile, baselineName, generateSchema } from './lib/schema.mjs';
import { migrationsDirectory } from './lib/migrations.mjs';

assert.deepEqual((await readdir(migrationsDirectory)).sort(), [baselineName], 'Keep only the current empty-database baseline.');
assert.equal(
    (await readFile(baselineFile, 'utf8')).replaceAll('\r\n', '\n'),
    await generateSchema(),
    'Initialization SQL differs from schema.ts or rules.sql. Run pnpm db:generate.',
);
console.log('Current schema and initialization SQL agree.');