import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../src/http.ts';
import { remoteAdminDatabase } from './lib/admin-database.mjs';
import { clearBucket, clearLocalBucket, resetDemoData } from './lib/demo-reset.mjs';
import { runWrangler, withDatabaseCommands } from './lib/database-cli.mjs';
import { cloudEnvironment, loadRemoteTarget, localStateDirectory, openLocalTarget, parseTargetArguments } from './lib/target.mjs';

const usage = `重置指定环境为演示数据（在 backend 目录执行）：
  pnpm demo --local
  pnpm demo --remote .local/remote.json
删除目标 D1 的全部表和视图（含迁移记录）及 R2 桶内全部文件，
重新应用全部迁移、演示学期和开题演示数据。
保留已初始化管理员的 ID、昵称和密码散列；会话及其他业务数据全部删除。
远程配置必须含 accountId、databaseId、bucketName，Token 从 CLOUDFLARE_API_TOKEN 或隐藏输入读取。
每次执行都重置，不需要额外确认；先清理 R2，失败时不改动 D1。
本地可用 --persist-to <状态根目录> 指定隔离目录，默认 .wrangler/state。`;

export function parseDemoArguments(args) {
    return parseTargetArguments(args);
}

export async function runDemoCommand(args, { environment = process.env, invoke = runWrangler,
    openLocal = openLocalTarget, request = fetch, output = process.stdout, prompt } = {}) {
    const options = parseDemoArguments(args);
    if (options.help) { output.write(`${usage}\n`); return; }
    const target = options.remote ? await loadRemoteTarget(options.remote, { requireBucket: true }) : null;
    output.write(target ? `Cloudflare 账号：${target.accountId}\n目标 D1：${target.databaseId}\n目标 R2：${target.bucketName}\n`
        : `本地状态根目录：${localStateDirectory(options['persist-to'])}\n`);
    const env = target ? await cloudEnvironment(target, environment, prompt) : environment;
    let platform;
    try {
        if (options.local) platform = await openLocal(options['persist-to']);
        const binding = target ? remoteAdminDatabase(target, env.CLOUDFLARE_API_TOKEN, request) : {
            prepare: (...values) => platform.env.DB.prepare(...values), batch: (...values) => platform.env.DB.batch(...values),
        };
        return await withDatabaseCommands(options, target, env, async commands => {
            // Release local SQLite handles before Wrangler opens the same persisted database.
            const databaseStep = async action => {
                if (platform) { await platform.dispose(); platform = undefined; }
                await commands[action]();
                if (options.local) platform = await openLocal(options['persist-to']);
            };
            const result = await resetDemoData(binding, {
                clearFiles: () => target
                    ? clearBucket({ accountId: target.accountId, bucket: target.bucketName, token: env.CLOUDFLARE_API_TOKEN }, request)
                    : clearLocalBucket(platform.env.FILES),
                migrate: () => databaseStep('migrate'), seed: () => databaseStep('seed'),
            });
            output.write(`已删除 ${result.droppedObjects} 个表或视图、${result.deletedFiles} 个 R2 文件，并应用全部迁移。\n`);
            output.write(`演示数据：${result.courseName} (${result.courseId})，学期 ${result.termName}，新增 ${result.createdAccounts} 个账号。\n`);
            output.write(result.administratorId ? `已保留管理员 ${result.administratorId}，密码不变。\n` : '重置前没有已初始化的管理员，需要时执行 admin:init 并指定同一目标。\n');
            return result;
        }, invoke);
    } finally { await platform?.dispose(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await runDemoCommand(process.argv.slice(2)); }
    catch (error) {
        console.error(error instanceof HttpError ? error.message : '重置未确认成功。请检查目标配置、Token 权限及迁移；未输出底层异常或凭据。');
        process.exitCode = 1;
    }
}