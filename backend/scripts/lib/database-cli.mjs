import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { HttpError } from '../../src/http.ts';
import { backendDirectory, cloudEnvironment, loadRemoteTarget, localStateDirectory, parseTargetArguments } from './target.mjs';

const usage = `数据库操作（在 backend 目录执行）：
  pnpm db:migrate --local
  pnpm db:migrate --remote .local/remote.json
应用尚未执行的迁移；空库按顺序应用完整历史。演示数据由 pnpm demo 初始化。
远程配置含 accountId、databaseId，可带 bucketName；凭据通过 CLOUDFLARE_API_TOKEN 或隐藏输入提供。
本地可用 --persist-to <状态根目录> 指定隔离目录，默认 .wrangler/state。
不会清空数据、初始化管理员或部署网站。`;

export function parseDatabaseArguments(args) {
    const [action, ...rest] = args;
    if (action !== 'migrate') throw new HttpError(400, 'INVALID_ACTION', '数据库命令仅支持 migrate；演示数据请使用 pnpm demo');
    return { action, ...parseTargetArguments(rest) };
}

export function runWrangler(args, environment) {
    const bin = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin/wrangler.js');
    const result = spawnSync(process.execPath, [bin, ...args], { cwd: backendDirectory, env: environment, stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new HttpError(503, 'WRANGLER_FAILED', '数据库命令未确认成功，请核对目标和迁移记录；未自动重试');
}

export async function withDatabaseCommands(options, target, environment, operation, invoke = runWrangler) {
    let temporary;
    try {
        let flags;
        if (options.local) {
            flags = ['--config', join(backendDirectory, 'wrangler.json'), '--env', 'local', '--local', '--persist-to', localStateDirectory(options['persist-to'])];
        } else {
            // Isolate the explicit D1 target from the deployment configuration. Never write credentials to disk.
            const local = join(backendDirectory, '.local');
            await mkdir(local, { recursive: true });
            temporary = await mkdtemp(join(local, 'database-target-'));
            const config = join(temporary, 'wrangler.json');
            const { compatibility_date } = JSON.parse(await readFile(join(backendDirectory, 'wrangler.json'), 'utf8'));
            await writeFile(config, JSON.stringify({ name: 'coursestack-database', compatibility_date,
                account_id: target.accountId, d1_databases: [{ binding: 'DB', database_name: target.databaseId,
                    database_id: target.databaseId, migrations_dir: join(backendDirectory, 'migrations') }] }));
            flags = ['--config', config, '--remote'];
        }
        return await operation({
            migrate: () => invoke(['d1', 'migrations', 'apply', 'DB', ...flags], environment),
            seed: () => invoke(['d1', 'execute', 'DB', '--file', join(backendDirectory, 'seed/local.sql'), ...flags], environment),
        });
    } finally {
        if (temporary) {
            if (dirname(temporary) !== join(backendDirectory, '.local')) throw new Error('Unexpected temporary config path');
            await rm(temporary, { recursive: true, force: true });
        }
    }
}

export async function runDatabaseCommand(args, { environment = process.env, invoke = runWrangler, output = process.stdout, prompt } = {}) {
    const options = parseDatabaseArguments(args);
    if (options.help) { output.write(`${usage}\n`); return; }
    const target = options.remote ? await loadRemoteTarget(options.remote) : null;
    output.write(target ? `Cloudflare 账号：${target.accountId}\n目标 D1：${target.databaseId}\n` : `本地状态根目录：${localStateDirectory(options['persist-to'])}\n`);
    const env = target ? await cloudEnvironment(target, environment, prompt) : environment;
    return withDatabaseCommands(options, target, env, commands => commands.migrate(), invoke);
}