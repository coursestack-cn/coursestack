import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { Log, LogLevel, Miniflare } from 'miniflare';
import assert from 'node:assert/strict';

let compiled: string | undefined;
export const internalToken = 'local-test-internal-service-token-2026';
// Our migrations keep the closing END; of each trigger on its own line.
// Preparing each complete statement also tests D1's real SQLite trigger support.
export function statements(source: string) {
  const result: string[] = []; let current = '';
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('--')) continue;
    current += line + '\n';
    if (line.trimEnd().endsWith(';') && (!/^CREATE TRIGGER/i.test(current.trim()) || /END;\s*$/.test(current))) {
      result.push(current.trim()); current = '';
    }
  }
  if (current.trim()) throw new Error('Incomplete SQL migration');
  return result;
}
export async function start(options: { internalToken?: string; appEnv?: 'local' | 'dev' | 'production' } = {}) {
  compiled ??= buildSync({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', target: 'es2022', write: false }).outputFiles[0].text;
  const mf = new Miniflare({ modules: true, script: compiled, scriptPath: resolve('src/index.ts'),
    compatibilityDate: '2026-07-01', d1Databases: { DB: 'member3-test' }, r2Buckets: ['FILES'],
    bindings: { APP_ENV: options.appEnv ?? 'local', ALLOWED_ORIGIN: 'http://localhost:5173', INTERNAL_API_TOKEN: options.internalToken ?? internalToken },
    log: new Log(LogLevel.ERROR) });
  try {
    const database = await mf.getD1Database('DB');
    for (const file of readdirSync('../database/migrations').filter(x => x.endsWith('.sql')).sort()) {
      for (const statement of statements(readFileSync(`../database/migrations/${file}`, 'utf8'))) await database.prepare(statement).run();
    }
    for (const statement of statements(readFileSync('../database/seeds/local.sql', 'utf8'))) await database.prepare(statement).run();
    const worker = await mf.getWorker();
    async function api(method: string, path: string, as?: string, data?: unknown, opts: { key?: string; headers?: Record<string, string>; internal?: boolean } = {}) {
      const response = await worker.fetch('http://localhost' + (opts.internal ? path : '/api' + path), {
        method, headers: { ...(as ? { Authorization: `Bearer local-${as}-token-2026` } : {}),
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(method === 'POST' && !opts.internal ? { 'Idempotency-Key': opts.key ?? crypto.randomUUID() } : {}), ...opts.headers },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, data: await response.json() as any, headers: response.headers };
    }
    async function postQuestion(as = 'student-a', extra: Record<string, unknown> = {}, course = 'course-a') {
      const response = await api('POST', `/courses/${course}/questions`, as, { title: '极限如何计算？', body: '求解 $\\lim_{x \\to 0} \\sin x / x$。', ...extra });
      assert.equal(response.status, 201, JSON.stringify(response.data)); return response.data.id as string;
    }
    async function postAnswer(questionId: string, as = 'student-b', body = '利用夹逼定理，极限为1。') {
      const response = await api('POST', `/questions/${questionId}/answers`, as, { body });
      assert.equal(response.status, 201, JSON.stringify(response.data)); return response.data.id as string;
    }
    async function revision(id: string) {
      const response = await api('GET', `/contents/${id}`);
      assert.equal(response.status, 200); return response.data.revision as number;
    }
    async function accept(question: string, answer: string | null, as = 'teacher-a') {
      return api('PUT', `/questions/${question}/acceptance`, as, { answerId: answer, revision: await revision(question) });
    }
    async function policy(enabled = true, bonusPoints = 2) {
      const course = await api('GET', '/courses/course-a');
      const response = await api('PUT', '/courses/course-a/bonus-policy', 'teacher-a', { revision: course.data.revision, enabled, bonusPoints });
      assert.equal(response.status, 200, JSON.stringify(response.data)); return response;
    }
    return { mf, database, worker, api, postQuestion, postAnswer, revision, accept, policy, dispose: () => mf.dispose() };
  } catch (error) { await mf.dispose(); throw error; }
}
export type Harness = Awaited<ReturnType<typeof start>>;