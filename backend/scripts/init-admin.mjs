import { administratorMain } from './lib/admin-cli.mjs';

await administratorMain(['init', '--local', ...process.argv.slice(2)]);