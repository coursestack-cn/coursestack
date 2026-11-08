import { HttpError } from '../src/http.ts';
import { backfillSearchText } from './lib/search-backfill.mjs';
import { cloudEnvironment, loadRemoteTarget, localStateDirectory, openLocalTarget, parseTargetArguments } from './lib/target.mjs';
import { remoteAdminDatabase } from './lib/admin-database.mjs';

let local;
try {
    const options = parseTargetArguments(process.argv.slice(2), { check: { type: 'boolean' } });
    if (options.help) {
        console.log('搜索正文回填：pnpm search:backfill --local [--persist-to <隔离状态目录>] [--check]\n远程：pnpm search:backfill --remote <配置文件> [--check]\n先应用迁移并部署同步写入代码，再回填；--check 只检查，不写入。');
    } else {
        let database;
        if (options.remote) {
            const target = await loadRemoteTarget(options.remote);
            const environment = await cloudEnvironment(target);
            console.log('目标 D1：' + target.databaseId);
            database = remoteAdminDatabase(target, environment.CLOUDFLARE_API_TOKEN);
        } else {
            console.log('本地状态根目录：' + localStateDirectory(options['persist-to']));
            local = await openLocalTarget(options['persist-to']);
            database = local.env.DB;
        }
        const result = await backfillSearchText(database, { check: Boolean(options.check) });
        console.log(JSON.stringify(result));
        if (options.check && result.mismatches) process.exitCode = 1;
        if (!options.check) console.log('回填结束；请再次运行同一命令并加 --check 校验，期间发生的并发编辑会被保留。');
    }
} catch (error) {
    console.error(error instanceof HttpError ? error.message : '搜索回填未完成，请检查迁移、正文契约和目标配置；未输出正文或凭据。');
    process.exitCode = 1;
} finally { await local?.dispose(); }