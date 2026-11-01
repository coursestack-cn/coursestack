import { administratorState, initializeAdministrator, resetAdministratorPassword } from '../../src/auth/service.ts';
import { passwordField } from '../../src/auth/crypto.ts';
import { HttpError } from '../../src/http.ts';
import { remoteAdminDatabase } from './admin-database.mjs';
import { loadRemoteTarget, localStateDirectory, openLocalTarget, parseTargetArguments } from './target.mjs';
import { terminalPrompt } from './admin-prompt.mjs';

const usage = `管理员运维（在 backend 目录执行）：
  pnpm admin:init --local
  pnpm admin:reset --local
  pnpm admin:status --local
  pnpm admin:init --remote .local/remote.json
  pnpm admin:reset --remote .local/remote.json
  pnpm admin:status --remote .local/remote.json
远程 JSON 配置包含 accountId、databaseId，可带 bucketName。Token 从交互终端或 CLOUDFLARE_API_TOKEN 读取。
密码仅支持终端隐藏输入。命令不会部署 Worker、执行迁移或重置其他账号。`;

export function parseAdminArguments(args) {
    const [action, ...rest] = args;
    if (!['init', 'reset', 'status'].includes(action)) throw new HttpError(400, 'INVALID_ACTION', '请选择 init、reset 或 status');
    return { action, ...parseTargetArguments(rest) };
}

export async function runAdministratorCommand(args, {
    input = process.stdin, output = process.stdout, environment = process.env,
    prompt = (message, hidden) => terminalPrompt(message, { input, output, hidden }),
    openLocal = openLocalTarget, request = fetch,
} = {}) {
    const options = parseAdminArguments(args);
    if (options.help) { output.write(`${usage}\n`); return; }
    if (!input.isTTY) throw new HttpError(400, 'TERMINAL_REQUIRED', '请在交互终端运行管理员运维命令');
    let target;
    if (options.remote) {
        target = await loadRemoteTarget(options.remote);
        output.write(`远程 Cloudflare 账号：${target.accountId}\n目标 D1：${target.databaseId}\n`);
    } else {
        output.write(`本地状态根目录：${localStateDirectory(options['persist-to'])}\n`);
    }
    let platform;
    try {
        const binding = target
            ? remoteAdminDatabase(target, environment.CLOUDFLARE_API_TOKEN || await prompt('Cloudflare API Token（不回显）：', true), request)
            : (platform = await openLocal(options['persist-to'])).env.DB;
        const state = await administratorState(binding);
        if (state) output.write(`管理员 ID：${state.id}\n状态：${state.status}；凭据版本：${state.version ?? '未初始化'}\n`);
        else output.write('当前数据库尚无管理员。\n');
        if (options.action === 'status') {
            return { state };
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
        output.write(`管理员${options.action === 'init' ? '初始化' : '密码重置'}完成。账号：${result.id}\n`);
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