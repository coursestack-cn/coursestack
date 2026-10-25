import { administratorMain } from './lib/admin-cli.mjs';

await administratorMain(process.argv.slice(2));