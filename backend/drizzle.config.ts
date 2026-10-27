import { defineConfig } from 'drizzle-kit';

// Drizzle Lab reads this schema. db:generate writes the current empty-database baseline.
export default defineConfig({
    dialect: 'sqlite',
    schema: './src/db/schema.ts',
    out: './migrations',
    breakpoints: true,
});