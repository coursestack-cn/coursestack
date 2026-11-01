import { defineConfig } from 'drizzle-kit';

// Drizzle Lab reads this schema. db:generate appends D1 migrations with STRICT tables and SQL rules.
export default defineConfig({
    dialect: 'sqlite',
    schema: './src/db/schema.ts',
    out: './migrations',
    breakpoints: true,
});