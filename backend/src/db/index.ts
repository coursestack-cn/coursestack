import { drizzle } from 'drizzle-orm/d1';
import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.ts';

export function createDatabase(binding: D1Database) {
    return drizzle(binding, { schema });
}

export type Database = ReturnType<typeof createDatabase>;

const dialect = new SQLiteSyncDialect();
export function prepareStatement(binding: D1Database, statement: SQL) {
    const { sql, params } = dialect.sqlToQuery(statement);
    return binding.prepare(sql).bind(...params);
}