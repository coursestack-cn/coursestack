import { writeFile } from 'node:fs/promises';
import { baselineFile, generateSchema } from './lib/schema.mjs';

if (process.argv.length > 2) throw new Error('db:generate regenerates the current schema; it accepts no migration arguments.');
await writeFile(baselineFile, await generateSchema());
console.log('Generated migrations/0000_schema.sql for an empty database. No database was modified.');