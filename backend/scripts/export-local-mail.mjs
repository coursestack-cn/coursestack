import { mkdir, writeFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';

const output = new URL('../.local/mail/', import.meta.url);
const platform = await getPlatformProxy({
  configPath: new URL('../wrangler.json', import.meta.url).pathname,
  environment: 'local', envFiles: [], remoteBindings: false,
  persist: { path: new URL('../.wrangler/state/v3', import.meta.url).pathname },
});
try {
  await mkdir(output, { recursive: true, mode: 0o700 });
  let cursor;
  let count = 0;
  do {
    const page = await platform.env.FILES.list({ prefix: 'local-mail/', cursor });
    for (const entry of page.objects) {
      const object = await platform.env.FILES.get(entry.key);
      if (!object) continue;
      const filename = entry.key.slice('local-mail/'.length);
      if (!/^[a-f0-9-]+\.json$/.test(filename)) continue;
      await writeFile(new URL(filename, output), await object.text(), { mode: 0o600 });
      count++;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  console.log(`已导出 ${count} 封本地模拟邮件至 backend/.local/mail/，内容不输出到日志。`);
} finally { await platform.dispose(); }