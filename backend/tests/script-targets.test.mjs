import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { backendDirectory, loadRemoteTarget, openLocalTarget, parseTargetArguments } from '../scripts/lib/target.mjs';
import { parseDatabaseArguments, runDatabaseCommand } from '../scripts/lib/database-cli.mjs';
import { parseAdminArguments, runAdministratorCommand } from '../scripts/lib/admin-cli.mjs';
import { parseDemoArguments, runDemoCommand } from '../scripts/demo.mjs';
import { clearLocalBucket } from '../scripts/lib/demo-reset.mjs';
import { readMigrations } from '../scripts/lib/migrations.mjs';

const remote = { accountId: 'a'.repeat(32), databaseId: '11111111-2222-4333-8444-555555555555', bucketName: 'fixture-materials' };
const quiet = { write() {} };
async function workspace() {
    const local = join(backendDirectory, '.local');
    await mkdir(local, { recursive: true });
    const directory = await mkdtemp(join(local, 'script-target-test-'));
    return { directory, async dispose() {
        assert.equal(dirname(directory), local);
        await rm(directory, { recursive: true, force: true });
    } };
}
const wrangler = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin/wrangler.js');
const invoke = (args, environment) => {
    const result = spawnSync(process.execPath, [wrangler, ...args], { cwd: backendDirectory, env: environment,
        encoding: 'utf8', timeout: 60000, windowsHide: true });
    assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
};

test('all targeted commands require exactly --local or --remote <config> and reject old aliases and credentials', () => {
    const parsers = [parseTargetArguments, args => parseAdminArguments(['status', ...args]),
        args => parseDatabaseArguments(['migrate', ...args]), parseDemoArguments];
    for (const parse of parsers) {
        assert.equal(parse(['--local']).local, true);
        assert.equal(parse(['--remote', 'target with spaces.json']).remote, 'target with spaces.json');
        for (const args of [[], ['--remote'], ['--remote', ''], ['--local', '--remote', ''],
            ['--local', '--remote', 'target.json'], ['--local', '--local'], ['--remote', 'a', '--remote', 'b'],
            ['--remote', '--config', 'target.json'], ['--remote', 'target.json', '--persist-to', 'state'],
            ['--local', '--token', 'fixture-secret'], ['--local', '--persist-to', '']]) {
            assert.throws(() => parse(args), error => !error.message.includes('fixture-secret'));
        }
    }
});

test('remote migration uses the configured account and D1, excludes credentials from disk, and cleans temporary config', async () => {
    const task = await workspace();
    try {
        const config = join(task.directory, 'remote.json');
        await writeFile(config, JSON.stringify(remote));
        const calls = [];
        let temporary;
        const options = { environment: { CLOUDFLARE_API_TOKEN: 'fixture-secret', CLOUDFLARE_ACCOUNT_ID: 'wrong-account' }, output: quiet,
            async invoke(args, env) {
                temporary = args[args.indexOf('--config') + 1];
                const text = await readFile(temporary, 'utf8');
                const target = JSON.parse(text);
                assert.equal(target.account_id, remote.accountId);
                assert.equal(target.d1_databases[0].database_id, remote.databaseId);
                assert.equal(env.CLOUDFLARE_ACCOUNT_ID, remote.accountId);
                assert.equal(env.CLOUDFLARE_API_TOKEN, 'fixture-secret');
                assert.equal(text.includes('fixture-secret'), false);
                assert.ok(args.includes('--remote'));
                assert.equal(args.includes('--local'), false);
                calls.push(args.slice(0, 3));
            } };
        await runDatabaseCommand(['migrate', '--remote', config], options);
        assert.deepEqual(calls, [['d1', 'migrations', 'apply']]);
        await assert.rejects(stat(temporary), { code: 'ENOENT' });
        calls.length = 0;
        await assert.rejects(runDatabaseCommand(['migrate', '--remote', config], { ...options,
            async invoke(args) { temporary = args[args.indexOf('--config') + 1]; calls.push(args); throw new Error('fixture failure'); } }), /fixture failure/);
        assert.equal(calls.length, 1, 'a failed migration must not be retried');
        await assert.rejects(stat(temporary), { code: 'ENOENT' });
    } finally { await task.dispose(); }
});

test('remote demo configuration is checked before credentials, connections or writes', async () => {
    const task = await workspace();
    try {
        const config = join(task.directory, 'remote.json');
        const unavailable = () => assert.fail('must not access credentials or resources');
        for (const target of [{ ...remote, token: 'fixture-secret' }, { ...remote, bucketName: 123 },
            { ...remote, databaseId: '00000000-0000-0000-0000-000000000001' },
            { accountId: remote.accountId, databaseId: remote.databaseId }]) {
            await writeFile(config, JSON.stringify(target));
            await assert.rejects(loadRemoteTarget(config, { requireBucket: true }), { code: 'INVALID_TARGET' });
            await assert.rejects(runDemoCommand(['--remote', config], {
                prompt: unavailable, invoke: unavailable, openLocal: unavailable, request: unavailable, output: quiet,
            }), { code: 'INVALID_TARGET' });
        }
    } finally { await task.dispose(); }
});

test('local bucket cleanup collects all pages before deleting', async () => {
    const calls = [];
    const bucket = {
        async list(options) {
            calls.push(`list:${options.cursor ?? ''}`);
            return options.cursor ? { truncated: false, objects: [{ key: 'second' }] }
                : { truncated: true, cursor: 'next', objects: [{ key: 'first' }] };
        },
        async delete(key) { calls.push(`delete:${key}`); },
    };
    assert.equal(await clearLocalBucket(bucket), 2);
    assert.deepEqual(calls, ['list:', 'list:next', 'delete:first', 'delete:second']);
});

test('local demo initializes empty state and always resets while migration and admin share the same target', async () => {
    const task = await workspace();
    const persist = join(task.directory, 'state');
    const flags = ['--local', '--persist-to', persist];
    const environment = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
    const options = { environment, invoke, output: quiet };
    let platform;
    try {
        const initial = await runDemoCommand(flags, options);
        assert.equal(initial.administratorId, null);
        assert.equal(initial.createdAccounts, 105);
        platform = await openLocalTarget(persist);
        let db = platform.env.DB;
        assert.equal(await db.prepare('SELECT count(*) AS n FROM terms').first('n'), 2);
        const administratorId = await db.prepare("SELECT id FROM accounts WHERE role='admin'").first('id');
        assert.equal(await db.prepare("SELECT password FROM accounts WHERE role='admin'").first('password'), null);
        await db.prepare("UPDATE accounts SET password='kept-hash' WHERE role='admin'").run();
        await db.prepare("INSERT INTO sessions(token_hash,account_id,credential_version,expires_at) VALUES('old-session',?,1,9999999999)").bind(administratorId).run();
        await db.prepare("UPDATE accounts SET nickname='changed-demo', password='changed-hash' WHERE school_number='S0001'").run();
        await platform.env.FILES.put('fixture-old-file', 'fixture');
        await platform.dispose(); platform = undefined;
        await runDatabaseCommand(['migrate', ...flags], options);
        const status = await runAdministratorCommand(['status', ...flags], { input: { isTTY: true }, output: quiet });
        assert.equal(status.state.id, administratorId);
        const reset = await runDemoCommand(flags, options);
        assert.equal(reset.deletedFiles, 1);
        assert.equal(reset.createdAccounts, 105);
        platform = await openLocalTarget(persist);
        db = platform.env.DB;
        assert.deepEqual(await db.prepare("SELECT id,password FROM accounts WHERE role='admin'").first(), { id: administratorId, password: 'kept-hash' });
        assert.equal(await db.prepare('SELECT count(*) AS n FROM sessions').first('n'), 0);
        assert.equal(await db.prepare('SELECT count(*) AS n FROM accounts').first('n'), 106);
        const student = await db.prepare("SELECT nickname,password FROM accounts WHERE school_number='S0001'").first();
        assert.equal(student.nickname, '演示同学 001');
        assert.notEqual(student.password, 'changed-hash');
        assert.deepEqual((await db.prepare('SELECT id,name,current FROM terms ORDER BY id').all()).results, [
            { id: '25-2', name: '2026春', current: 0 }, { id: '26-1', name: '2026秋', current: 1 },
        ]);
        assert.deepEqual((await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.map(row => row.name), (await readMigrations()).map(m => m.name));
        assert.deepEqual((await platform.env.FILES.list()).objects, []);
    } finally {
        await platform?.dispose();
        await task.dispose();
    }
});