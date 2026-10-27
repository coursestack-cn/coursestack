import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { app } from '../src/index.ts';
import { openapi } from '../src/openapi.ts';

const actual = new Set(app.routes.filter(r => r.method !== 'ALL' && !['/', '/openapi.json', '/api/openapi.json', '/api/health'].includes(r.path)
  && !r.path.startsWith('/api/local/')).map(r => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, '{$1}')}`));
const documented = new Set(Object.entries(openapi.paths).flatMap(([path, methods]) => Object.keys(methods).map(method => `${method} ${path}`)));
assert.deepEqual([...actual].sort(), [...documented].sort(), 'OpenAPI 必须覆盖所有业务接口');
const exported = JSON.stringify(openapi, null, 2);
const target = '../docs/api/openapi.json';
if (process.argv.includes('--export')) {
  mkdirSync('../docs/api', { recursive: true }); writeFileSync(target, exported, 'utf8');
} else assert.equal(readFileSync(target, 'utf8'), exported, '规范有变化，请运行 pnpm openapi:export');
console.log(`OpenAPI ${openapi.openapi}: ${actual.size} 个业务方法，路由与静态规范一致。`);