import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { initializeAdministrator } from '../src/auth/service.ts';
import { HttpError } from '../src/http.ts';

async function hiddenPrompt(message) {
    process.stdout.write(message);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    return new Promise((resolve, reject) => {
        let value = '';
        const finish = (error) => {
            process.stdin.off('data', onData);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write('\n');
            if (error) reject(error); else resolve(value);
        };
        const onData = (chunk) => {
            for (const character of chunk) {
                if (character === '\u0003' || character === '\u0004') { finish(new Error('cancelled')); return; }
                if (character === '\r' || character === '\n') { finish(); return; }
                if (character === '\u007f' || character === '\b') value = Array.from(value).slice(0, -1).join('');
                else if (character >= ' ' && value.length < 256) value += character;
            }
        };
        process.stdin.on('data', onData);
    });
}

let platform;
try {
    if (!process.stdin.isTTY) throw new Error('terminal required');
    const password = await hiddenPrompt('本地管理员密码（输入不回显）：');
    const confirmation = await hiddenPrompt('再次输入密码：');
    if (password !== confirmation) throw new HttpError(400, 'MISMATCH', '两次密码不一致');
    platform = await getPlatformProxy({
        configPath: fileURLToPath(new URL('../wrangler.json', import.meta.url)),
        environment: 'local',
        envFiles: [],
        remoteBindings: false,
        persist: { path: fileURLToPath(new URL('../.wrangler/state/v3', import.meta.url)) },
    });
    await initializeAdministrator(platform.env.DB, password);
    console.log('本地唯一管理员初始化完成。');
} catch (error) {
    console.error(error instanceof HttpError ? error.message : '初始化未完成。请使用交互终端，并先执行本地迁移；现有管理员密码不会被覆盖。');
    process.exitCode = 1;
} finally {
    await platform?.dispose();
}