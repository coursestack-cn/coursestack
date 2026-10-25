import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { cleanupAvatars } from '../src/accounts/avatar.ts';

const platform = await getPlatformProxy({
    configPath: fileURLToPath(new URL('../wrangler.json', import.meta.url)),
    environment: 'local', envFiles: [], remoteBindings: false,
    persist: { path: fileURLToPath(new URL('../.wrangler/state/v3', import.meta.url)) },
});
try {
    const count = await cleanupAvatars(platform.env);
    console.log(`已清理 ${count} 个超过一小时且未被引用的本地头像对象。`);
} finally { await platform.dispose(); }