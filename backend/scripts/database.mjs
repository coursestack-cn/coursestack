import { HttpError } from '../src/http.ts';
import { runDatabaseCommand } from './lib/database-cli.mjs';

try { await runDatabaseCommand(process.argv.slice(2)); }
catch (error) {
    console.error(error instanceof HttpError ? error.message : '数据库操作未确认成功，请核对配置和迁移记录；未输出底层异常或凭据');
    process.exitCode = 1;
}