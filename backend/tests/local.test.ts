import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, type Harness } from './harness';
let h: Harness;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
test('健康检查实际查询本地 D1，未知 API 始终返回 JSON', async () => {
  const r = await h.api('GET', '/health');
  assert.equal(r.status, 200); assert.equal(r.data.checks.d1, 'ok');
  const missing = await h.api('GET', '/this-api-does-not-exist?x=1');
  assert.equal(missing.status, 404); assert.equal(missing.data.error.code, 'NOT_FOUND');
});
test('本地会话可以经代理以 HttpOnly Cookie 发布内容，退出清除 Cookie', async () => {
  const session = await h.api('POST', '/local/session', undefined, { userId: 'student-a' });
  assert.equal(session.status, 200);
  const cookie = session.headers.get('set-cookie')!;
  assert.ok(cookie.includes('HttpOnly')); assert.ok(!cookie.includes('__Host-')); assert.ok(!cookie.includes('Domain='));
  const created = await h.api('POST', '/courses/course-a/questions', undefined, { title: 'Cookie 会话问题', body: '真实 D1 写入' },
    { headers: { Cookie: cookie.split(';')[0], Origin: 'http://localhost:5173' } });
  assert.equal(created.status, 201);
  const logout = await h.api('DELETE', '/local/session', undefined, undefined, { headers: { Cookie: cookie.split(';')[0], Origin: 'http://localhost:5173' } });
  assert.equal(logout.status, 200); assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
  const replay = await h.api('POST', '/courses/course-a/questions', undefined, { title: '旧Cookie重放', body: '应被拒绝' },
    { headers: { Cookie: cookie.split(';')[0], Origin: 'http://localhost:5173' } });
  assert.equal(replay.status, 401);
});
test('本地测试身份入口拒绝跨站请求和任意账号', async () => {
  const cross = await h.api('POST', '/local/session', undefined, { userId: 'admin' }, { headers: { Origin: 'http://127.0.0.1:9999' } });
  assert.equal(cross.status, 403);
  assert.equal((await h.api('POST', '/local/session', undefined, { userId: 'production-admin' })).status, 400);
});
test('dev 和生产环境均关闭本地身份切换入口', async () => {
  await h.dispose(); h = await start({ appEnv: 'dev' });
  assert.equal((await h.api('POST', '/local/session', undefined, { userId: 'admin' })).status, 404);
  assert.match((await h.worker.fetch('http://localhost/')).headers.get('Content-Type')!, /text\/plain/);
  assert.equal((await h.api('GET', '/local/versions?courseId=course-a')).status, 404);
  await h.dispose(); h = await start({ appEnv: 'production' });
  assert.equal((await h.api('POST', '/local/session', undefined, { userId: 'admin' })).status, 404);
  assert.match((await h.worker.fetch('http://localhost/')).headers.get('Content-Type')!, /text\/plain/);
});
test('local 首页提供可操作验收页，非回环域名不提供本地界面', async () => {
  const response = await h.worker.fetch('http://localhost/');
  assert.match(response.headers.get('Content-Type')!, /text\/html/);
  const text = await response.text();
  assert.ok(text.includes('id="editor-form"')); assert.ok(text.includes('id="identity"'));
  assert.ok(text.includes('id="view-moderation"'));
  const external = await h.worker.fetch('http://example.com/');
  assert.match(external.headers.get('Content-Type')!, /text\/plain/);
});
test('本地资料版本选择器只读取同课程、当前可用的真实版本', async () => {
  const response = await h.api('GET', '/local/versions?courseId=course-a');
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.items.map((v: { id: string }) => v.id), ['version-a2', 'version-a1']);
  await h.database.prepare("UPDATE materials SET status='hidden' WHERE id='material-a'").run();
  assert.equal((await h.api('GET', '/local/versions?courseId=course-a')).data.items.length, 0);
});
test('本地种子可重复导入，已修改的课程和会话不会被重置', async () => {
  await h.api('PATCH', '/courses/course-a', 'teacher-a', { revision: 1, name: '本地修改后课程' });
  const { readFileSync } = await import('node:fs');
  const { statements } = await import('./harness');
  for (const statement of statements(readFileSync('../database/seeds/local.sql', 'utf8'))) await h.database.prepare(statement).run();
  assert.equal((await h.api('GET', '/courses/course-a')).data.name, '本地修改后课程');
  assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM courses').first('n'), 2);
});