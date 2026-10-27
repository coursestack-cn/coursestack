import { defineConfig } from 'drizzle-kit';

// Kit generates files only. Wrangler applies the same SQL history to each D1 environment.
export default defineConfig({
    dialect: 'sqlite',
    schema: './src/db/schema.ts',
    out: './migrations',
    breakpoints: true,
});