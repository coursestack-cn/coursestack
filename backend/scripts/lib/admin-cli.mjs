import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { administratorState, initializeAdministrator, resetAdministratorPassword } from '../../src/auth/service.ts';
import { passwordField } from '../../src/auth/crypto.ts';
import { HttpError } from '../../src/http.ts';
import { remoteAdminDatabase, validateRemoteTarget } from './admin-database.mjs';
import { terminalPrompt } from './admin-prompt.mjs';

const usage = `管理员运维（在 backend 目录执行）：
  pnpm admin:init --local
  pnpm admin:reset --local
  pnpm admin:status --local
  pnpm admin:init --remote --config .local/admin-production.json
  pnpm admin:reset --remote --config .local/admin-production.json
  pnpm admin:status --remote --config .local/admin-production.json
远程 JSON 配置仅包含 accountId、databaseId。Token 从交互终端或 CLOUDFLARE_API_TOKEN 读取。
密码仅支持终端隐藏输入。命令不会部署 Worker、执行迁移或重置其他账号。`;

export function parseAdminArguments(args) {
    const [action, ...rest] = args;
    let parsed;
    try {
        parsed = parseArgs({ args: rest, strict: true, allowPositionals: false, tokens: true, options: {
            local: { type: 'boolean' }, remote: { type: 'boolean' }, config: { type: 'string' }, help: { type: 'boolean' },
        } });
        const names = parsed.tokens.filter((token) => token.kind === 'option').map((token) => token.name);
        if (new Set(names).size !== names.length) throw new Error();
    } catch {
        throw new HttpError(400, 'INVALID_ARGUMENTS', '命令参数不正确；请使用 --help，勿在参数中传入密码或 Token');
    }
    if (!['init', 'reset', 'status'].includes(action)) throw new HttpError(400, 'INVALID_ACTION', '请选择 init、reset 或 status');
    const { values } = parsed;
    if (values.help) return { action, help: true };
    if (Boolean(values.local) === Boolean(values.remote) || (values.local && values.config) || (values.remote && !values.config)) {
        throw new HttpError(400, 'TARGET_REQUIRED', '必须明确选择 --local 或 --remote --config <配置文件>');
    }
    return { action, ...values };
}

async function connectLocal() {
    const { getPlatformProxy } = await import('wrangler');
    return getPlatformProxy({
        configPath: fileURLToPath(new URL('../../wrangler.json', import.meta.url)),
        environment: 'local', envFiles: [], remoteBindings: false,
        persist: { path: fileURLToPath(new URL('../../.wrangler/state/v3', import.meta.url)) },
    });
}

export async function runAdministratorCommand(args, {
    input = process.stdin, output = process.stdout, environment = process.env,
    prompt = (message, hidden) => terminalPrompt(message, { input, output, hidden }),
    openLocal = connectLocal, request = fetch,
} = {}) {
    const options = parseAdminArguments(args);
    if (options.help) { output.write(`${usage}\n`); return; }
    if (!input.isTTY) throw new HttpError(400, 'TERMINAL_REQUIRED', '请在交互终端运行管理员运维命令');
    let target;
    if (options.remote) {
        try { target = JSON.parse(await readFile(options.config, 'utf8')); }
        catch { throw new HttpError(400, 'INVALID_TARGET', '无法读取远程配置，请检查 --config 指向的 JSON 文件'); }
        validateRemoteTarget(target);
        output.write(`远程 Cloudflare 账号：${target.accountId}\n目标 D1：${target.databaseId}\n`);
    } else {
        output.write('目标：本地 local 数据库，backend/.wrangler/state\n');
    }
    let platform;
    try {
        const binding = target
            ? remoteAdminDatabase(target, environment.CLOUDFLARE_API_TOKEN || await prompt('Cloudflare API Token（不回显）：', true), request)
            : (platform = await openLocal()).env.DB;
        const state = await administratorState(binding);
        if (state) output.write(`管理员 ID：${state.id}\n状态：${state.status}；凭据版本：${state.version ?? '未初始化'}\n`);
        else output.write('当前数据库尚无管理员。\n');
        if (options.action === 'status') {
            const audit = state && await binding.prepare(`SELECT id, action, created_at AS createdAt FROM account_audit
                WHERE target_id = ? AND action IN ('admin.initialize', 'admin.password.reset')
                ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(state.id).first();
            if (audit) output.write(`最近运维审计：${audit.id}；${audit.action}；Unix 时间：${audit.createdAt}\n`);
            return { state, audit };
        }
        if (options.action === 'init' && state?.version != null) throw new HttpError(409, 'ADMIN_EXISTS', '管理员已初始化，不能覆盖密码；需要恢复时使用 admin:reset');
        if (state && (state.status !== 'active' || state.schoolNumber !== null)) throw new HttpError(409, 'ADMIN_UNAVAILABLE', '管理员状态异常，请先检查数据库');
        if (options.action === 'reset' && state?.version == null) throw new HttpError(409, 'ADMIN_NOT_INITIALIZED', '管理员尚未初始化，请使用 admin:init');
        const password = passwordField(await prompt('新管理员密码（不回显）：', true));
        if (password !== await prompt('再次输入密码（不回显）：', true)) throw new HttpError(400, 'MISMATCH', '两次密码不一致，未执行写入');
        if (options.action === 'reset') output.write('重置将撤销该管理员所有会话，保留账号、个人资料及业务数据。\n');
        const confirmation = `${options.action.toUpperCase()} ${target?.databaseId ?? 'local'}`;
        if (await prompt(`输入 ${confirmation} 确认：`, false) !== confirmation) throw new HttpError(400, 'CANCELLED', '确认不匹配，未执行写入');
        const result = options.action === 'init'
            ? await initializeAdministrator(binding, password)
            : await resetAdministratorPassword(binding, password, { id: state.id, version: state.version });
        output.write(`管理员${options.action === 'init' ? '初始化' : '密码重置'}完成。审计记录：${result.receipt}\n`);
        return result;
    } finally {
        await platform?.dispose();
    }
}

export async function administratorMain(args) {
    try { await runAdministratorCommand(args); }
    catch (error) {
        console.error(error instanceof HttpError ? error.message : '操作未确认成功，请检查数据库迁移和管理员状态；未自动重试，也未输出底层错误详情');
        process.exitCode = 1;
    }
}