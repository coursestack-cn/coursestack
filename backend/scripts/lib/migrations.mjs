import { readFile, readdir } from 'node:fs/promises';

export const migrationsDirectory = new URL('../../migrations/', import.meta.url);

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