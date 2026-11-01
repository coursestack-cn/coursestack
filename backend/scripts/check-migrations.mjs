import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { generateSnapshot, joinStatements, readRules, snapshotModel } from './lib/schema.mjs';
import { readHistory, splitMigration } from './lib/migrations.mjs';

const usage = `检查仓库中的迁移文件（不连接数据库，在 backend 目录执行）：
  pnpm db:check
检查迁移编号、SQL 文件与 journal 的对应关系、快照链，以及最新快照与 schema、rules 的一致性。
不读取本地或远程 D1 的结构、数据或迁移执行记录，不接受 --local 或 --remote。`;

let options;
try {
    const { values, tokens } = parseArgs({ strict: true, allowPositionals: false, tokens: true, options: { help: { type: 'boolean' } } });
    if (tokens.length > 1) throw new Error('Duplicate argument');
    options = values;
} catch {
    console.error('db:check 仅检查仓库中的迁移文件，只接受 --help；不支持 --local、--remote 或其他参数，未连接任何数据库。');
    process.exitCode = 1;
}

if (options?.help) console.log(usage);
else if (options) {
    const { journal, snapshots, rules } = await readHistory();
    assert.deepEqual(snapshotModel(snapshots.at(-1)), snapshotModel(await generateSnapshot()),
        'Schema differs from the latest migration snapshot. Run pnpm db:generate --name <change>.');
    assert.equal(joinStatements(splitMigration(rules.at(-1))), await readRules(),
        'Rules differ from the latest migration snapshot. Run pnpm db:generate --name <change>.');
    console.log(`仓库迁移文件检查通过：${journal.entries.length} 项迁移，历史、最新结构快照与规则一致。未连接本地或远程数据库。`);
}