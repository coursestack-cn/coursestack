import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HttpError } from '../../src/http.ts';
import { validateRemoteTarget } from './admin-database.mjs';
import { terminalPrompt } from './admin-prompt.mjs';

export const backendDirectory = fileURLToPath(new URL('../../', import.meta.url));
export const localStateDirectory = value => value ? resolve(value) : join(backendDirectory, '.wrangler/state');

export function parseTargetArguments(args, extra = {}) {
    let values;
    try {
        const parsed = parseArgs({ args, strict: true, allowPositionals: false, tokens: true, options: {
            local: { type: 'boolean' }, remote: { type: 'string' }, 'persist-to': { type: 'string' }, help: { type: 'boolean' }, ...extra,
        } });
        const names = parsed.tokens.filter(token => token.kind === 'option').map(token => token.name);
        if (new Set(names).size !== names.length) throw new Error();
        values = parsed.values;
    } catch { throw new HttpError(400, 'INVALID_ARGUMENTS', '参数不正确，请使用 --help；远程用 --remote <配置文件>，不要在参数中传递密码或 Token'); }
    if (values.help) return values;
    if (Boolean(values.local) === (values.remote !== undefined) || values.remote !== undefined && !values.remote.trim()
        || values.remote !== undefined && values['persist-to'] !== undefined
        || values['persist-to'] !== undefined && !values['persist-to'].trim()) {
        throw new HttpError(400, 'TARGET_REQUIRED', '必须明确选择 --local 或 --remote <配置文件>；--persist-to 仅用于本地状态根目录');
    }
    return values;
}

export async function loadRemoteTarget(file, { requireBucket = false } = {}) {
    let target;
    try { target = JSON.parse(await readFile(file, 'utf8')); }
    catch { throw new HttpError(400, 'INVALID_TARGET', '无法读取远程配置，请检查 --remote 指向的 JSON 文件'); }
    validateRemoteTarget(target);
    if (requireBucket && !target.bucketName) throw new HttpError(400, 'INVALID_TARGET', '重置演示数据的远程配置必须包含 bucketName');
    return target;
}

export async function cloudEnvironment(target, environment = process.env, prompt = terminalPrompt) {
    const token = environment.CLOUDFLARE_API_TOKEN || await prompt('Cloudflare API Token（不回显）：', { hidden: true });
    if (!token?.trim()) throw new HttpError(400, 'TOKEN_REQUIRED', '需要具有目标资源权限的 Cloudflare API Token');
    return { ...environment, CLOUDFLARE_ACCOUNT_ID: target.accountId, CLOUDFLARE_API_TOKEN: token };
}

export async function openLocalTarget(persistTo) {
    const { getPlatformProxy } = await import('wrangler');
    return getPlatformProxy({ configPath: join(backendDirectory, 'wrangler.json'), environment: 'local',
        envFiles: [], remoteBindings: false, persist: { path: join(localStateDirectory(persistTo), 'v3') } });
}