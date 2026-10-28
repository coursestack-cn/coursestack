import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HttpError } from '../src/http.ts';
import { remoteAdminDatabase, validateRemoteTarget } from './lib/admin-database.mjs';
import { terminalPrompt } from './lib/admin-prompt.mjs';
import { clearBucket, resetDemoData } from './lib/demo-reset.mjs';

const usage = `重置 production 为演示数据（在 backend 目录执行，供 CI 部署后使用）：
  pnpm demo:reset --confirm <production D1 ID>
删除 production D1 的全部表和视图（含迁移记录）及 R2 桶内全部文件，
重新应用初始化 SQL、seed/local.sql 的演示学期和开题演示数据。
保留已初始化管理员的 ID、昵称和密码散列；会话及其他业务数据全部删除。
目标 D1 和 R2 桶读取 wrangler.json 的 production 环境；Account ID 从 CLOUDFLARE_ACCOUNT_ID 读取，
Token 从 CLOUDFLARE_API_TOKEN 或终端隐藏输入读取，需要 D1 与 R2 写权限。
--confirm 必须与目标 D1 ID 一致，不会交互确认。`;
const backend = fileURLToPath(new URL('..', import.meta.url));

export function parseResetArguments(args) {
    let options;
    try {
        const parsed = parseArgs({ args, strict: true, allowPositionals: false, tokens: true, options: {
            confirm: { type: 'string' }, help: { type: 'boolean' },
        } });
        const names = parsed.tokens.filter((t) => t.kind === 'option').map((t) => t.name);
        if (new Set(names).size !== names.length) throw new Error();
        options = parsed.values;
    } catch { throw new HttpError(400, 'INVALID_ARGUMENTS', '参数不正确，请使用 --help；不要在命令行中传递 Token。'); }
    if (!options.help && !options.confirm) throw new HttpError(400, 'CONFIRMATION_REQUIRED', '必须用 --confirm <production D1 ID> 确认重置目标。');
    return options;
}

function wrangler(args, environment) {
    const bin = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');
    const result = spawnSync(process.execPath, [bin, ...args, '--env', 'production', '--remote'], { cwd: backend, env: environment, stdio: 'inherit' });
    if (result.status !== 0) throw new HttpError(503, 'WRANGLER_FAILED', `wrangler ${args.slice(0, 3).join(' ')} 未成功；D1 可能已被清空，请修复后重新运行。`);
}

async function main() {
    const options = parseResetArguments(process.argv.slice(2));
    if (options.help) { console.log(usage); return; }
    if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new HttpError(400, 'ACCOUNT_REQUIRED', '需要通过 CLOUDFLARE_ACCOUNT_ID 提供 Cloudflare 账号 ID。');
    const production = JSON.parse(await readFile(join(backend, 'wrangler.json'), 'utf8')).env.production;
    const target = validateRemoteTarget({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, databaseId: production.d1_databases[0].database_id });
    const bucket = production.r2_buckets[0].bucket_name;
    if (options.confirm !== target.databaseId) throw new HttpError(400, 'CANCELLED', '--confirm 与 production D1 ID 不一致，未修改任何数据。');
    console.log(`Cloudflare 账号：${target.accountId}\n目标 D1：${target.databaseId}\n目标 R2：${bucket}`);
    const token = process.env.CLOUDFLARE_API_TOKEN || await terminalPrompt('Cloudflare API Token（不回显）：', { hidden: true });
    const environment = { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: target.accountId };
    const result = await resetDemoData(remoteAdminDatabase(target, token), {
        clearFiles: () => clearBucket({ accountId: target.accountId, bucket, token }),
        migrate: () => wrangler(['d1', 'migrations', 'apply', 'DB'], environment),
        seed: () => wrangler(['d1', 'execute', 'DB', '--file', 'seed/local.sql'], environment),
    });
    console.log(`已删除 ${result.droppedObjects} 个表或视图、${result.deletedFiles} 个 R2 文件，并重新初始化结构。`);
    console.log(`演示数据：${result.courseName} (${result.courseId})，学期 ${result.termName}，新增 ${result.createdAccounts} 个账号。`);
    console.log(result.administratorId ? `已保留管理员 ${result.administratorId}，密码不变。` : '重置前没有已初始化的管理员，需要时由运维执行 admin:init。');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await main(); }
    catch (error) {
        console.error(error instanceof HttpError ? error.message : '重置未确认成功。请检查目标配置、Token 权限及迁移；未输出底层异常或凭据。');
        process.exitCode = 1;
    }
}