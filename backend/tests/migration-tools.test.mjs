import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readMigrations } from '../scripts/lib/migrations.mjs';

const backend = fileURLToPath(new URL('../', import.meta.url));
const local = join(backend, '.local');
async function workspace(prefix) {
    await mkdir(local, { recursive: true });
    const directory = await mkdtemp(join(local, prefix));
    return { directory, async dispose() {
        assert.ok(resolve(directory).startsWith(resolve(local) + sep));
        await rm(directory, { recursive: true, force: true });
    } };
}
const run = (args, cwd) => {
    const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60000,
        env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, windowsHide: true });
    assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
    return result.stdout;
};
const directoryUrl = directory => pathToFileURL(directory + sep);
async function files(directory) {
    return Object.fromEntries(await Promise.all((await readdir(directory, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile()).map(async entry => {
            const path = join(entry.parentPath, entry.name);
            return [path.slice(directory.length + 1), await readFile(path, 'utf8')];
        })));
}

test('migration file check rejects target and unknown arguments instead of reporting a database check', async () => {
    const task = await workspace('migration-check-arguments-');
    try {
        const missingConfig = join(task.directory, 'missing.json');
        const cli = ['--experimental-strip-types', 'scripts/check-migrations.mjs'];
        for (const args of [['--remote', missingConfig, '--arbitrary-option', 'fixture-secret'], ['--local'],
            ['--unknown', 'fixture-secret'], ['unexpected'], ['--help', '--help'], ['--help', '--remote', missingConfig]]) {
            const result = spawnSync(process.execPath, [...cli, ...args], { cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 10000 });
            assert.equal(result.status, 1, result.error?.message ?? result.stdout);
            assert.equal(result.stdout, '');
            assert.match(result.stderr, /不支持 --local、--remote/);
            assert.doesNotMatch(result.stderr, /fixture-secret/);
        }
        assert.match(run([...cli, '--help'], backend), /不连接数据库/);
        assert.match(run(cli, backend), /仓库迁移文件检查通过.*未连接本地或远程数据库/);
    } finally { await task.dispose(); }
});

test('generation appends schema and rule migrations, preserves history and makes no changes on a repeated run', async () => {
    const task = await workspace('migration-generator-');
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21', d1Databases: ['DB'] }));
    try {
        for (const path of ['scripts/lib', 'src/db']) await mkdir(join(task.directory, path), { recursive: true });
        for (const path of ['scripts/generate-schema.mjs', 'scripts/check-migrations.mjs', 'scripts/lib/schema.mjs',
            'scripts/lib/migrations.mjs', 'src/db/schema.ts', 'src/db/rules.sql']) {
            await cp(join(backend, path), join(task.directory, path));
        }
        const migrations = join(task.directory, 'migrations');
        await cp(join(backend, 'migrations'), migrations, { recursive: true });
        const before = await files(migrations);
        const historyLength = (await readMigrations(directoryUrl(migrations))).length;
        const generate = name => run(['--experimental-strip-types', 'scripts/generate-schema.mjs', '--name', name], task.directory);
        generate('unchanged');
        assert.deepEqual(await files(migrations), before);

        const schema = join(task.directory, 'src/db/schema.ts');
        await writeFile(schema, (await readFile(schema, 'utf8')).replace("nickname: text('nickname'),", "nickname: text('nickname'),\n    migrationNote: text('migration_note'),")
            + "\n\nexport const migrationProbe = sqliteTable('migration_probe', { id: text('id').primaryKey().notNull(), value: integer('value').notNull().default(0) });");
        const rules = join(task.directory, 'src/db/rules.sql');
        const probeRule = '\n--> statement-breakpoint\nCREATE TRIGGER migration_probe_value AFTER INSERT ON migration_probe BEGIN UPDATE migration_probe SET value=NEW.value+1 WHERE id=NEW.id; END;';
        await writeFile(rules, (await readFile(rules, 'utf8')) + probeRule);
        generate('append_probe');
        const appended = await files(migrations);
        for (const [path, content] of Object.entries(before)) if (!path.endsWith('_journal.json')) assert.equal(appended[path], content, path);
        assert.ok(appended[`${String(historyLength).padStart(4, '0')}_append_probe.sql`]);
        generate('unchanged_again');
        assert.deepEqual(await files(migrations), appended);
        run(['--experimental-strip-types', 'scripts/check-migrations.mjs'], task.directory);

        const db = await runtime.getD1Database('DB');
        const history = await readMigrations(directoryUrl(migrations));
        for (const migration of history.slice(0, historyLength)) await db.batch(migration.statements.map(sql => db.prepare(sql)));
        await db.prepare("INSERT INTO accounts(id,nickname,role,password) VALUES('kept-admin','管理员','admin','kept-hash')").run();
        await db.batch(history[historyLength].statements.map(sql => db.prepare(sql)));
        assert.deepEqual(await db.prepare("SELECT nickname,password,migration_note FROM accounts WHERE id='kept-admin'").first(),
            { nickname: '管理员', password: 'kept-hash', migration_note: null });
        assert.equal((await db.prepare('PRAGMA table_list').all()).results.find(table => table.name === 'migration_probe').strict, 1);
        await db.prepare("INSERT INTO migration_probe(id) VALUES('first')").run();
        assert.equal(await db.prepare("SELECT value FROM migration_probe WHERE id='first'").first('value'), 1);

        await writeFile(rules, (await readFile(rules, 'utf8')).replace('value=NEW.value+1', 'value=NEW.value+2'));
        generate('rule_only');
        const ruleChange = (await readMigrations(directoryUrl(migrations))).at(-1);
        assert.equal(ruleChange.name, `${String(historyLength + 1).padStart(4, '0')}_rule_only.sql`);
        await db.batch(ruleChange.statements.map(sql => db.prepare(sql)));
        await db.prepare("INSERT INTO migration_probe(id) VALUES('second')").run();
        assert.equal(await db.prepare("SELECT value FROM migration_probe WHERE id='second'").first('value'), 2);
        assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    } finally {
        await runtime.dispose();
        await task.dispose();
    }
});

test('Wrangler upgrades an existing local D1 once and skips applied migrations on repeat', async () => {
    const task = await workspace('migration-wrangler-');
    try {
        const migrations = join(task.directory, 'migrations');
        await mkdir(migrations);
        await cp(join(backend, 'migrations/0000_schema.sql'), join(migrations, '0000_schema.sql'));
        const config = join(task.directory, 'wrangler.json');
        await writeFile(config, JSON.stringify({ name: 'migration-test', compatibility_date: '2026-10-21', env: { local: {
            d1_databases: [{ binding: 'DB', database_name: 'migration-test-db',
                database_id: '00000000-0000-0000-0000-000000000002', migrations_dir: migrations }],
        } } }));
        const wrangler = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin/wrangler.js');
        const flags = ['--config', config, '--env', 'local', '--local', '--persist-to', join(task.directory, 'state')];
        const apply = () => run([wrangler, 'd1', 'migrations', 'apply', 'DB', ...flags], task.directory);
        const query = sql => JSON.parse(run([wrangler, 'd1', 'execute', 'DB', ...flags, '--command', sql, '--json'], task.directory));
        apply();
        query("INSERT INTO accounts(id,nickname,role,password) VALUES('preserved-admin','管理员','admin','preserved-password');");
        await cp(join(backend, 'migrations/0001_materials.sql'), join(migrations, '0001_materials.sql'));
        apply();
        const sql = "SELECT id,name,applied_at FROM d1_migrations ORDER BY id; SELECT password FROM accounts WHERE id='preserved-admin';";
        const result = query(sql).map(entry => entry.results);
        assert.deepEqual(result[0].map(row => row.name), ['0000_schema.sql', '0001_materials.sql']);
        assert.deepEqual(result[1], [{ password: 'preserved-password' }]);
        apply();
        assert.deepEqual(query(sql).map(entry => entry.results), result);
        assert.equal(query("SELECT COUNT(*) AS n FROM pragma_table_info('file_versions') WHERE name='storage_key'")[0].results[0].n, 1);
    } finally { await task.dispose(); }
});