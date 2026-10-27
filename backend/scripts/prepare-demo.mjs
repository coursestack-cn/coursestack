import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { HttpError } from '../src/http.ts';
import { prepareDemoData } from './lib/demo-data.mjs';
import { remoteAdminDatabase, validateRemoteTarget } from './lib/admin-database.mjs';
import { terminalPrompt } from './lib/admin-prompt.mjs';

const usage = `开题演示数据（在 backend 目录执行）：
  pnpm demo:prepare --local --dry-run
  pnpm demo:prepare --local
  pnpm demo:prepare --remote --config .local/admin-dev.json --dry-run
  pnpm demo:prepare --remote --config .local/admin-dev.json
可选 --course-id <已有课程 ID>；--persist-to <目录> 仅用于隔离的本地数据库。
学生 S0001–S0100、教师 T0001，初始密码同账号，不强制改密。
使用当前学期；没有当前学期时新建“演示学期”。默认复用或新建“数据库系统原理”。
只补充缺少的演示数据，不覆盖已有账号密码或资料，不删除业务内容。
远程配置只含 accountId、databaseId，Token 从 CLOUDFLARE_API_TOKEN 或终端隐藏输入读取。
本命令不执行迁移、不部署网站。先应用全部迁移，再运行本命令。`;

export function parseDemoArguments(args) {
    let options;
    try {
        const parsed = parseArgs({ args, strict: true, allowPositionals: false, tokens: true, options: {
            local: { type: 'boolean' }, remote: { type: 'boolean' }, config: { type: 'string' },
            'dry-run': { type: 'boolean' }, 'course-id': { type: 'string' }, 'persist-to': { type: 'string' }, help: { type: 'boolean' },
        } });
        const names = parsed.tokens.filter((t) => t.kind === 'option').map((t) => t.name);
        if (new Set(names).size !== names.length) throw new Error();
        options = parsed.values;
    } catch { throw new HttpError(400, 'INVALID_ARGUMENTS', '参数不正确，请使用 --help；不要在命令行中传递 Token。'); }
    if (options.help) return options;
    if (Boolean(options.local) === Boolean(options.remote) || options.local && options.config
        || options.remote && (!options.config || options['persist-to'])) {
        throw new HttpError(400, 'TARGET_REQUIRED', '必须明确选择 --local 或 --remote --config <配置文件>。');
    }
    return options;
}

async function main() {
    const options = parseDemoArguments(process.argv.slice(2));
    if (options.help) { console.log(usage); return; }
    let platform;
    try {
        let binding;
        let target;
        if (options.remote) {
            target = validateRemoteTarget(JSON.parse(await readFile(options.config, 'utf8')));
            console.log(`Cloudflare 账号：${target.accountId}\n目标 D1：${target.databaseId}`);
            const token = process.env.CLOUDFLARE_API_TOKEN || await terminalPrompt('Cloudflare API Token（不回显）：', { hidden: true });
            binding = remoteAdminDatabase(target, token);
        } else {
            const { getPlatformProxy } = await import('wrangler');
            const persistPath = options['persist-to'] ? resolve(options['persist-to']) : fileURLToPath(new URL('../.wrangler/state/v3', import.meta.url));
            console.log(`目标：本地 local 数据库 ${persistPath}`);
            platform = await getPlatformProxy({ configPath: fileURLToPath(new URL('../wrangler.json', import.meta.url)),
                environment: 'local', envFiles: [], remoteBindings: false, persist: { path: persistPath } });
            binding = platform.env.DB;
        }
        const preview = await prepareDemoData(binding, { dryRun: true, course: options['course-id'] });
        console.log(`课程：${preview.courseName} (${preview.courseId})\n学期：${preview.termName} (${preview.termId})`);
        console.log(`新增账号 ${preview.createdAccounts} 个，保留已有演示账号 ${preview.existingAccounts} 个。`);
        if (options['dry-run']) { console.log('预览完成，未写入数据。'); return; }
        if (target) {
            const confirmation = `PREPARE ${target.databaseId}`;
            if (await terminalPrompt(`输入 ${confirmation} 确认写入：`, { hidden: false }) !== confirmation) {
                throw new HttpError(400, 'CANCELLED', '确认不匹配，未写入数据。');
            }
        }
        console.log('正在生成密码散列并准备数据……');
        const result = await prepareDemoData(binding, { course: options['course-id'] });
        console.log(`完成：新增 ${result.createdAccounts} 个账号，保留 ${result.existingAccounts} 个账号；已建立 100 个学生修读关系和 T0001 授课关系。`);
        console.log('新增账号初始密码同账号，已有账号密码保持不变。');
    } finally { await platform?.dispose(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await main(); }
    catch (error) {
        console.error(error instanceof HttpError ? error.message : '准备数据未确认成功。请检查迁移、目标配置及现有演示数据；未输出底层异常或凭据。');
        process.exitCode = 1;
    }
}