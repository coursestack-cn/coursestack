import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { readMigrations } from '../scripts/lib/migrations.mjs';
import { PassThrough } from 'node:stream';
import { after, before, beforeEach, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { administratorState, initializeAdministrator, resetAdministratorPassword, login, changePassword } from '../src/auth/service.ts';
import { digest, hashPassword, randomToken, verifyPassword } from '../src/auth/crypto.ts';
import { runAdministratorCommand, parseAdminArguments } from '../scripts/lib/admin-cli.mjs';
import { remoteAdminDatabase, validateRemoteTarget } from '../scripts/lib/admin-database.mjs';
import { terminalPrompt } from '../scripts/lib/admin-prompt.mjs';
import worker from '../src/index.ts';

let runtime;
let binding;
let originalHash;
let targetPath;
const password = 'fictional-admin-password-123';
const nextPassword = 'fictional-new-password-456';
const remoteTarget = { accountId: 'a'.repeat(32), databaseId: '11111111-2222-4333-8444-555555555555' };

before(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({
        modules: true, script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21', d1Databases: ['DB'],
    }));
    binding = await runtime.getD1Database('DB');
    for (const { statements } of await readMigrations()) {
        await binding.batch(statements.map((sql) => binding.prepare(sql)));
    }
    originalHash = await hashPassword(password);
    await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
    targetPath = new URL(`../.local/admin-maintenance-${crypto.randomUUID()}.json`, import.meta.url);
    await writeFile(targetPath, JSON.stringify(remoteTarget), { flag: 'wx' });
});

after(async () => {
    await runtime?.dispose();
    if (targetPath) await unlink(targetPath);
});

beforeEach(async () => {
    await binding.batch(['sessions', 'login_attempts', 'accounts']
        .map((table) => binding.prepare(`DELETE FROM ${table}`)));
});

async function fixture() {
    await binding.batch([
        binding.prepare("INSERT INTO accounts (id, nickname, role, school_number, password, name) VALUES ('admin', '测试管理员', 'admin', NULL, ?, '测试姓名'), ('member', '测试教师', 'teacher', 'T-001', ?, NULL)").bind(originalHash, originalHash),
    ]);
    return administratorState(binding);
}

async function addSession(id) {
    const token = randomToken();
    await binding.prepare('INSERT INTO sessions SELECT ?, id, credential_version, unixepoch() + 3600 FROM accounts WHERE id = ?')
        .bind(await digest(token), id).run();
    return new Request('https://local/api/auth/me', { headers: { Cookie: `coursestack_session=${token}` } });
}

const count = (table, id) => binding.prepare(`SELECT count(*) AS n FROM ${table} WHERE account_id = ?`).bind(id).first('n');
const authenticated = (request) => worker.fetch(request, { DB: binding, APP_ENV: 'local' });

test('initialization creates one administrator', async () => {
    const result = await initializeAdministrator(binding, password);
    const state = await administratorState(binding);
    assert.equal(state.id, result.id);
    assert.equal(state.version, 1);
    assert.equal(state.schoolNumber, null);
    await assert.rejects(initializeAdministrator(binding, nextPassword), (error) => error.code === 'ADMIN_EXISTS');
    assert.equal((await administratorState(binding)).version, 1);
    assert.equal((await login(binding, password, null)).profile.id, state.id);
});

test('external reset revokes only administrator sessions and retains the profile', async () => {
    const state = await fixture();
    const privateBefore = await binding.prepare("SELECT id, nickname, name, department, major, grade FROM accounts WHERE id = 'admin'").first();
    const first = await addSession('admin'), second = await addSession('admin'), member = await addSession('member');
    for (const key of ['admin-login', 'password:admin', 'member:T-001', 'ip:local']) {
        await binding.prepare('INSERT INTO login_attempts VALUES (?, 99, unixepoch() + 900)').bind(await digest(key)).run();
    }
    await resetAdministratorPassword(binding, nextPassword, state);
    assert.equal((await administratorState(binding)).version, 2);
    assert.deepEqual(await binding.prepare("SELECT id, nickname, name, department, major, grade FROM accounts WHERE id = 'admin'").first(), privateBefore);
    assert.equal(await count('sessions', 'admin'), 0);
    for (const request of [first, second]) assert.equal((await authenticated(request)).status, 401);
    assert.equal((await authenticated(member)).status, 200);
    await assert.rejects(login(binding, password, null), (error) => error.code === 'INVALID_CREDENTIALS');
    assert.equal((await login(binding, nextPassword, null)).profile.id, 'admin');
    for (const key of ['admin-login', 'password:admin']) assert.equal(await binding.prepare('SELECT attempts FROM login_attempts WHERE key = ?').bind(await digest(key)).first(), null);
    assert.equal(await binding.prepare('SELECT count(*) AS n FROM login_attempts').first('n'), 2);
});

test('stale external reset cannot overwrite a password changed after operator inspection', async () => {
    const state = await fixture();
    const session = await addSession('admin');
    await changePassword(binding, session, password, nextPassword);
    await assert.rejects(resetAdministratorPassword(binding, 'fictional-third-password-789', state), (error) => error.code === 'ADMIN_CHANGED');
    assert.equal((await login(binding, nextPassword, null)).profile.id, 'admin');
});

test('concurrent external resets from the same inspected version have one winner', async () => {
    const state = await fixture();
    const outcomes = await Promise.allSettled([
        resetAdministratorPassword(binding, nextPassword, state),
        resetAdministratorPassword(binding, 'fictional-third-password-789', state),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find((result) => result.status === 'rejected').reason.code, 'ADMIN_CHANGED');
    assert.equal((await administratorState(binding)).version, 2);
});

test('an old-password login paused before session insertion cannot survive external reset', async () => {
    const state = await fixture();
    const reached = Promise.withResolvers(), resume = Promise.withResolvers();
    const pending = login({ prepare: binding.prepare.bind(binding), async batch(statements) {
        reached.resolve(); await resume.promise; return binding.batch(statements);
    } }, password, null);
    const rejected = assert.rejects(pending, (error) => error.code === 'INVALID_CREDENTIALS');
    try {
        await Promise.race([reached.promise, pending.then(() => { throw new Error('Login did not pause'); })]);
        await resetAdministratorPassword(binding, nextPassword, state);
    } finally { resume.resolve(); await rejected; }
    assert.equal(await count('sessions', 'admin'), 0);
});

test('failed password write rolls back revocation and credential version together', async () => {
    const state = await fixture();
    const session = await addSession('admin');
    await binding.exec("CREATE TRIGGER reject_maintenance BEFORE UPDATE ON accounts BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    try { await assert.rejects(resetAdministratorPassword(binding, nextPassword, state), /test failure/); }
    finally { await binding.exec('DROP TRIGGER reject_maintenance;'); }
    assert.equal((await administratorState(binding)).version, 1);
    assert.equal((await authenticated(session)).status, 200);
});

test('external reset rejects missing, disabled and non-administrator targets and invalid passwords', async () => {
    await assert.rejects(resetAdministratorPassword(binding, nextPassword, { id: 'missing', version: 1 }), (error) => error.code === 'ADMIN_CHANGED');
    const state = await fixture();
    await assert.rejects(resetAdministratorPassword(binding, '', state), (error) => error.code === 'INVALID_PASSWORD');
    await assert.rejects(resetAdministratorPassword(binding, nextPassword, { id: 'member', version: 1 }), (error) => error.code === 'ADMIN_CHANGED');
    await binding.prepare("UPDATE accounts SET status = 'disabled' WHERE id = 'admin'").run();
    await assert.rejects(resetAdministratorPassword(binding, nextPassword, state), (error) => error.code === 'ADMIN_CHANGED');
    assert.equal((await administratorState(binding)).version, 1);
});

test('CLI rejects ambiguous destinations, secret arguments and placeholder remote IDs', () => {
    for (const args of [['reset'], ['init', '--local', '--remote'], ['reset', '--remote'], ['init', '--local', '--config', 'target'], ['reset', '--local', '--password', password], ['init', '--local', '--local']]) {
        assert.throws(() => parseAdminArguments(args), (error) => !error.message.includes(password));
    }
    for (const target of [{ ...remoteTarget, databaseId: '00000000-0000-0000-0000-000000000001' }, { ...remoteTarget, token: 'secret' }, { accountId: '../wrong', databaseId: remoteTarget.databaseId }]) {
        assert.throws(() => validateRemoteTarget(target), (error) => error.code === 'INVALID_TARGET');
    }
});

function consoleFixture(answers) {
    let text = '', disposed = false;
    return {
        options: { input: { isTTY: true }, output: { write(value) { text += value; } }, environment: {},
            prompt: async () => { assert.ok(answers.length); return answers.shift(); },
            openLocal: async () => ({ env: { DB: binding }, async dispose() { disposed = true; } }),
        },
        get text() { return text; }, get disposed() { return disposed; },
    };
}

test('local CLI initialization, status and reset use the same database without printing secrets', async () => {
    const initial = consoleFixture([password, password, 'INIT local']);
    await runAdministratorCommand(['init', '--local'], initial.options);
    assert.ok(initial.disposed); assert.ok(!initial.text.includes(password));
    const status = consoleFixture([]);
    const snapshot = await runAdministratorCommand(['status', '--local'], status.options);
    assert.equal(snapshot.state.version, 1); assert.deepEqual(Object.keys(snapshot), ['state']);
    const reset = consoleFixture([nextPassword, nextPassword, 'RESET local']);
    await runAdministratorCommand(['reset', '--local'], reset.options);
    assert.ok(reset.disposed); assert.ok(!reset.text.includes(nextPassword));
    assert.equal((await administratorState(binding)).version, 2);
});

test('cancelled, mismatched and noninteractive CLI commands do not modify credentials', async () => {
    await fixture();
    for (const answers of [[nextPassword, password], [nextPassword, nextPassword, 'no']]) {
        const console = consoleFixture(answers);
        await assert.rejects(runAdministratorCommand(['reset', '--local'], console.options), (error) => ['MISMATCH', 'CANCELLED'].includes(error.code));
        assert.ok(console.disposed);
        assert.equal((await administratorState(binding)).version, 1);
    }
    await assert.rejects(runAdministratorCommand(['reset', '--local'], { input: { isTTY: false } }), (error) => error.code === 'TERMINAL_REQUIRED');
});

test('remote CLI sends parameterized transactions to the exact configured D1 and never falls back locally', async () => {
    const requests = [];
    const console = consoleFixture(['fictional-cloudflare-token', password, password, `INIT ${remoteTarget.databaseId}`]);
    console.options.openLocal = () => { throw new Error('Remote must not use local database'); };
    console.options.request = async (url, options) => {
        assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${remoteTarget.accountId}/d1/database/${remoteTarget.databaseId}/query`);
        assert.equal(options.headers.Authorization, 'Bearer fictional-cloudflare-token');
        assert.equal(options.redirect, 'error');
        const payload = JSON.parse(options.body); requests.push(payload);
        assert.ok(!options.body.includes(password));
        const result = await binding.batch(payload.batch.map(({ sql, params }) => binding.prepare(sql).bind(...params)));
        return Response.json({ success: true, result });
    };
    const { fileURLToPath } = await import('node:url');
    const args = ['--remote', '--config', fileURLToPath(targetPath)];
    await runAdministratorCommand(['init', ...args], console.options);
    assert.ok(requests.some(({ batch }) => batch.length === 2));
    assert.ok(!console.text.includes(password)); assert.ok(!console.text.includes('fictional-cloudflare-token'));
    const reset = consoleFixture([nextPassword, nextPassword, `RESET ${remoteTarget.databaseId}`]);
    await runAdministratorCommand(['reset', ...args], { ...console.options, prompt: reset.options.prompt, environment: { CLOUDFLARE_API_TOKEN: 'fictional-cloudflare-token' } });
    assert.equal((await administratorState(binding)).version, 2);
    const saved = await binding.prepare("SELECT password FROM accounts WHERE role = 'admin'").first('password');
    assert.equal(await verifyPassword(nextPassword, saved), true);
});

test('remote failures redact provider output and are not retried', async () => {
    for (const response of [
        () => Response.json({ errors: [{ message: password }] }, { status: 403 }),
        () => Response.json({ success: false, errors: [{ message: password }] }),
        () => new Response(password, { status: 502 }),
        () => { throw new Error(password); },
        () => Response.json({ success: true, result: [] }),
    ]) {
        let calls = 0;
        const db = remoteAdminDatabase(remoteTarget, 'fictional-token', async () => { calls++; return response(); });
        await assert.rejects(db.prepare('SELECT 1').first(), (error) => !error.message.includes(password) && typeof error.code === 'string');
        assert.equal(calls, 1);
    }
});

test('terminal input is hidden and cancellation restores terminal mode', async () => {
    for (const ending of ['\r', '\u0003', 'end']) {
        const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
        input.setRawMode = (value) => { input.isRaw = value; };
        let text = '';
        const pending = terminalPrompt('Password: ', { input, output: { write(value) { text += value; } }, hidden: true });
        const result = ending === '\r' ? pending : assert.rejects(pending, (error) => error.code === 'CANCELLED');
        input.emit('data', password);
        if (ending === 'end') input.emit('end'); else input.emit('data', ending);
        if (ending === '\r') assert.equal(await result, password); else await result;
        assert.equal(input.isRaw, false); assert.equal(input.listenerCount('data'), 0);
        assert.ok(!text.includes(password)); input.destroy();
    }
});

test('initialization fills an existing administrator placeholder without replacing its identity or profile', async () => {
    await binding.prepare("INSERT INTO accounts(id,role,nickname,name) VALUES ('placeholder','admin',NULL,'保留姓名')").run();
    const result = await initializeAdministrator(binding, password);
    assert.equal(result.id, 'placeholder');
    const profile = await binding.prepare("SELECT id,nickname,name FROM accounts WHERE role='admin'").first();
    assert.deepEqual(profile, { id: 'placeholder', nickname: null, name: '保留姓名' });
    assert.equal((await login(binding, password, null)).profile.id, 'placeholder');
});