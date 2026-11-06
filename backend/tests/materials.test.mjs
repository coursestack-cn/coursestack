import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { start, doc, tokenFor } from './discussions-helpers.mjs';
import { cleanupMaterialUploads } from '../src/materials/cleanup.ts';
import { objectKeys } from '../src/materials/storage.ts';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const pdf = new TextEncoder().encode('%PDF-1.7\nfixture document\n%%EOF');
async function prepare(extra = {}, as = 'student-a', options = {}) {
    const body = extra.mode === 'version' ? { ...extra, file: extra.file ?? { size: pdf.length, type: 'application/pdf' } }
        : { mode: 'create', courseId: 'course-a', title: '微积分讲义.pdf', body: doc('资料介绍'), tags: ['期末'],
            file: { size: pdf.length, type: 'application/pdf' }, ...extra };
    const response = await h.api('POST', '/material-uploads', as, body, options);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
}
async function put(ticket, bytes = pdf, as = 'student-a', headers = {}) {
    return h.worker.fetch(ticket.url, { method: 'PUT', headers: { Origin: 'http://localhost',
        Cookie: `coursestack_session=${tokenFor(as)}`, ...ticket.headers, ...headers }, body: bytes });
}
async function publish(extra = {}, as = 'student-a', bytes = pdf) {
    const ticket = await prepare(extra, as);
    const sent = await put(ticket, bytes, as);
    assert.equal(sent.status, 204, await sent.text());
    const result = await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, as);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { ...result.data, ticket };
}
const fileRequest = (path, as = 'student-a', headers = {}, method = 'GET') => h.worker.fetch(`http://localhost/api${path}`, {
    method, headers: { ...(as ? { Cookie: `coursestack_session=${tokenFor(as)}` } : {}), ...headers },
});

test('single-file publication exposes metadata to guests and gates both preview and download', async () => {
    const item = await publish();
    assert.match(item.materialId, /^[a-f\d]{32}$/); assert.equal(item.version, 1);
    const detail = await h.api('GET', `/materials/${item.materialId}`);
    assert.equal(detail.status, 200); assert.equal(detail.data.title, '微积分讲义.pdf');
    assert.deepEqual(detail.data.body, doc('资料介绍'));
    assert.equal(detail.data.latestVersion.version, 1); assert.equal(detail.data.selectedVersion.size, pdf.length);
    assert.equal(detail.data.permissions.requiresLoginForFile, true);
    assert.equal(JSON.stringify(detail.data).includes('storage_key'), false);
    for (const action of ['preview', 'download']) {
        const path = `/materials/${item.materialId}/versions/1/${action}`;
        assert.equal((await fileRequest(path, null)).status, 401);
        const response = await fileRequest(path, 'visitor');
        assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/pdf');
        assert.match(response.headers.get('Content-Disposition'), /filename\*=UTF-8''/);
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
    }
    assert.equal((await h.api('GET', '/me/activity?kind=material', 'student-a')).data.items.find(x => x.id === item.materialId).latestVersion.version, 1);
});

test('one public filename covers all versions and replayed staging uploads cannot overwrite published bytes', async () => {
    const first = await publish();
    const second = await publish({ mode: 'version', materialId: first.materialId });
    assert.equal(second.version, 2);
    const changed = await h.api('PATCH', `/materials/${first.materialId}`, 'student-a', { title: '统一名称.pdf', tags: ['新标签'] });
    assert.equal(changed.status, 200); assert.equal(changed.data.selectedVersion.version, 2);
    assert.equal((await h.api('GET', `/materials/${first.materialId}?version=1`)).data.selectedVersion.version, 1);
    const other = new Uint8Array(pdf); other[12] = 88;
    await h.env.FILES.put(objectKeys(first.ticket.uploadId).staging, other, { httpMetadata: { contentType: 'application/pdf' } });
    assert.deepEqual((await h.api('POST', `/material-uploads/${first.ticket.uploadId}/confirm`, 'student-a')).data,
        { materialId: first.materialId, version: 1 });
    for (const version of [1, 2]) {
        const response = await fileRequest(`/materials/${first.materialId}/versions/${version}/download`);
        assert.ok(response.headers.get('Content-Disposition').includes(encodeURIComponent('统一名称.pdf')));
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
    }
    const columns = (await h.database.prepare('PRAGMA table_info(file_versions)').all()).results;
    assert.ok(['filename', 'change_note', 'status'].every(name => !columns.some(x => x.name === name)));
    assert.equal('status' in changed.data.selectedVersion, false);
    assert.equal('changeNote' in changed.data.selectedVersion, false);
    await assert.rejects(h.database.prepare('UPDATE file_versions SET storage_key=? WHERE material_id=? AND version=1').bind('replaced', first.materialId).run(), /file_version_identity_immutable/);
    assert.equal((await h.api('PATCH', `/contents/${first.materialId}`, 'student-a', { title: '../bad.pdf' })).status, 400);
});

test('questions and materials share tag filtering and database pagination without question-only filters leaking onto files', async () => {
    const material = await publish();
    const question = await h.postQuestion('student-b', { tags: ['期末'] });
    const first = await h.api('GET', '/courses/course-a/contents?tag=期末&pageSize=1&sort=newest');
    const second = await h.api('GET', '/courses/course-a/contents?tag=期末&pageSize=1&page=2&sort=newest');
    assert.equal(first.data.total, 2); assert.equal(second.data.total, 2);
    assert.deepEqual(new Set([...first.data.items, ...second.data.items].map(x => x.id)), new Set([material.materialId, question]));
    const onlyFiles = await h.api('GET', '/courses/course-a/contents?kind=material&tag=期末');
    assert.equal(onlyFiles.data.items[0].latestVersion.version, 1);
    assert.equal((await h.api('GET', '/courses/course-a/contents?state=unresolved')).status, 400);
    assert.equal((await h.api('GET', '/courses/course-a/contents?kind=material&sort=score')).status, 400);
    assert.equal((await h.api('GET', '/courses/course-a/contents?kind=question&state=unresolved')).data.total, 1);
    await h.api('PUT', `/contents/${material.materialId}/moderation`, 'teacher-a', { action: 'hide', reason: '临时下架资料' });
    assert.equal((await h.api('GET', '/courses/course-a/contents?tag=期末')).data.total, 1);
});

test('substring filters combine title, tags, kind, term and pagination while respecting visibility', async () => {
    const title = '期末复习.pdf', material = await publish({ title, tags: ['讲义', '期末复习', '期末试卷'] });
    const question = await h.postQuestion('student-b', { title: '期末复习.PDF', tags: ['问题', '期末试卷'] });
    await h.postQuestion('student-b', { title: `${title}（补充）`, tags: ['练习'] });
    await h.postQuestion('student-b', { title: '其他主题', tags: ['期末'] });
    await h.postQuestion('student-b', { title, tags: ['期末'] }, 'course-b');
    const list = params => h.api('GET', `/courses/course-a/contents?${new URLSearchParams(params)}`);
    assert.equal((await list({ title })).data.total, 3);
    const filters = { title: '  复习.pDf  ', tag: '  期末  ', termId: 'term-active', sort: 'newest', pageSize: '1' };
    const first = await list(filters), second = await list({ ...filters, page: '2' });
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal(first.data.total, 2); assert.equal(second.data.total, 2);
    assert.equal(first.data.items.length, 1); assert.equal(second.data.items.length, 1);
    assert.deepEqual(new Set([...first.data.items, ...second.data.items].map(row => row.id)), new Set([material.materialId, question]));
    const files = await list({ title, tag: '期末', kind: 'material' });
    assert.equal(files.data.total, 1); assert.equal(files.data.items[0].latestVersion.version, 1);
    const questions = await list({ title, tag: '期末', kind: 'question', state: 'unresolved', sort: 'score' });
    assert.equal(questions.data.total, 1); assert.equal(questions.data.items[0].id, question);
    for (const params of [{ title: '期末' }, { title: '期末复习.PDF' }]) assert.equal((await list(params)).data.total, 3);
    assert.equal((await list({ title, tag: '期' })).data.total, 2);
    for (const params of [{ title: '复习 期末' }, { title: '复习.pdfx' }, { title, tag: '期末 复习' }, { title, tag: '讲义期末' }, { title, termId: 'term-old' }]) {
        assert.equal((await list(params)).data.total, 0, JSON.stringify(params));
    }
    assert.equal((await h.api('PUT', `/contents/${material.materialId}/moderation`, 'teacher-a', { action: 'hide', reason: '暂停公开' })).status, 200);
    assert.equal((await list(filters)).data.total, 1);
    assert.equal((await h.api('DELETE', `/contents/${question}`, 'student-b')).status, 200);
    assert.equal((await list(filters)).data.total, 0);
});

test('content filters trim blanks, validate length and treat wildcard and SQL characters literally', async () => {
    const title = "讲义 100%_O'Reilly.PDF", material = await publish({ title, tags: ['复习', 'SQL_100%', '其他'] });
    await h.postQuestion('student-b', { title: '普通 SQL 讲义', tags: ['SQL', '100'] });
    await h.postQuestion('student-b', { title: '零标签', tags: [] });
    const list = params => h.api('GET', `/courses/course-a/contents?${new URLSearchParams(params)}`);
    for (const value of [title, '%', '_', "o'reILLY", 'pdf', '100%_']) {
        const result = await list({ title: value });
        assert.equal(result.data.total, 1); assert.equal(result.data.items[0].id, material.materialId);
    }
    for (const value of ['%', '_', 'sQl_100', 'SQL_100%']) {
        const result = await list({ tag: value });
        assert.equal(result.data.total, 1); assert.equal(result.data.items[0].id, material.materialId);
    }
    assert.equal((await list({ tag: 'sQl' })).data.total, 2);
    for (const value of ["' OR 1=1 --", '100X', '100_', '讲义 PDF']) assert.equal((await list({ title: value })).data.total, 0);
    for (const value of ["' OR 1=1 --", 'SQL100', 'SQL 100', '%_']) assert.equal((await list({ tag: value })).data.total, 0);
    const unfiltered = await h.api('GET', '/courses/course-a/contents');
    for (const value of ['', ' \t　 ']) assert.deepEqual((await list({ title: value, tag: value })).data, unfiltered.data);
    for (const [field, limit] of [['title', 200], ['tag', 30]]) {
        for (const character of ['中', '😀']) {
            assert.equal((await list({ [field]: character.repeat(limit) })).status, 200);
            const invalid = await list({ [field]: character.repeat(limit + 1) });
            assert.equal(invalid.status, 400); assert.equal(invalid.data.error.code, 'INVALID_FILTER');
        }
    }
});

test('upload permissions, single-file input and validation are enforced without duplicate detection', async () => {
    const data = { mode: 'create', courseId: 'course-a', title: 'test.pdf', body: doc('介绍'), file: { size: pdf.length, type: 'application/pdf' } };
    assert.equal((await h.api('POST', '/material-uploads', null, data)).status, 401);
    assert.equal((await h.api('POST', '/material-uploads', 'student-a', { ...data, files: [data.file] })).status, 400);
    assert.equal((await h.api('POST', '/material-uploads', 'student-a', { ...data, categoryId: 'x' })).status, 400);
    assert.equal((await h.api('POST', '/material-uploads', 'student-a', { ...data, changeNote: 'removed' })).status, 400);
    assert.equal((await h.api('POST', '/material-uploads', 'student-a', { ...data, file: { size: 1, type: 'text/html' } })).status, 400);
    assert.equal((await h.api('POST', '/material-uploads', 'student-a', { ...data, file: { size: 104857601, type: 'application/pdf' } })).status, 413);
    assert.equal((await h.api('POST', '/material-uploads', 'student-a', { ...data, title: 'bad\nname.pdf' })).status, 400);
    const first = await publish({}, 'visitor');
    const second = await publish({}, 'visitor');
    assert.notEqual(first.materialId, second.materialId); assert.equal('duplicate' in second.ticket, false);
    for (const as of ['student-a', 'teacher-a', 'teacher-b', 'admin']) {
        assert.equal((await h.api('POST', '/material-uploads', as, { mode: 'version', materialId: first.materialId, file: data.file })).status, 403);
    }
    assert.equal((await prepare({ mode: 'version', materialId: first.materialId }, 'visitor')).status, 'pending');
    const ticket = await prepare();
    assert.equal((await put(ticket, pdf, 'student-b')).status, 404);
    assert.equal((await h.api('GET', `/material-uploads/${ticket.uploadId}`, 'student-b')).status, 404);
    assert.equal((await put(ticket, pdf, 'student-a', { 'Content-Type': 'text/html' })).status, 415);
    assert.equal((await put(ticket, pdf.subarray(0, 5))).status, 400);
    const invalid = new Uint8Array(pdf.length);
    assert.equal((await put(ticket, invalid)).status, 204);
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 415);
    assert.equal((await put(ticket)).status, 204);
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 200);
});

test('prepare and confirm retries publish once and conflicting idempotency payloads are rejected', async () => {
    await h.policy({ pointsMaterial: 40, pointsMaterialVersion: 10 });
    const ticket = await prepare({}, 'student-a', { key: 'material-prepare-once' });
    const replay = await prepare({}, 'student-a', { key: 'material-prepare-once' });
    assert.equal(replay.uploadId, ticket.uploadId);
    assert.equal((await h.api('POST', '/material-uploads', 'student-a', { mode: 'create', courseId: 'course-a', title: 'different.pdf',
        body: doc('资料介绍'), tags: ['期末'], file: { size: pdf.length, type: 'application/pdf' } }, { key: 'material-prepare-once' })).status, 409);
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 409);
    assert.equal((await put(ticket)).status, 204);
    const results = await Promise.all([1, 2, 3].map(() => h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')));
    assert.ok(results.every(r => [200, 409].includes(r.status))); assert.ok(results.some(r => r.status === 200));
    const state = (await h.api('GET', `/material-uploads/${ticket.uploadId}`, 'student-a')).data;
    assert.equal(state.status, 'published');
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM file_versions WHERE material_id=?').bind(state.result.materialId).first('n'), 1);
    assert.equal(await h.database.prepare("SELECT SUM(delta_points) AS n FROM bonus_ledger WHERE student_id='student-a'").first('n'), 40);
    const done = await prepare({}, 'student-a', { key: 'material-prepare-once' });
    assert.deepEqual(done.result, state.result); assert.equal(done.status, 'published');
});

test('concurrent version publication allocates distinct numbers and removed numbers are never reused', async () => {
    const first = await publish();
    const tickets = await Promise.all([1, 2].map(() => prepare({ mode: 'version', materialId: first.materialId })));
    for (const ticket of tickets) assert.equal((await put(ticket)).status, 204);
    const results = await Promise.all(tickets.map(ticket => h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')));
    assert.ok(results.every(x => x.status === 200), JSON.stringify(results));
    assert.deepEqual(results.map(x => x.data.version).sort(), [2, 3]);
    assert.equal((await h.api('DELETE', `/materials/${first.materialId}/versions/3`, 'student-a')).status, 200);
    assert.equal((await publish({ mode: 'version', materialId: first.materialId })).version, 4);
    assert.equal((await h.api('GET', `/materials/${first.materialId}?version=3`)).status, 404);
});

test('Range, HEAD and conditional responses retain authentication and current visibility checks', async () => {
    const item = await publish(), path = `/materials/${item.materialId}/versions/1/preview`;
    const head = await fileRequest(path, 'student-a', {}, 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.headers.get('Content-Length'), String(pdf.length)); assert.equal(await head.text(), '');
    const part = await fileRequest(path, 'student-a', { Range: 'bytes=0-4' });
    assert.equal(part.status, 206); assert.equal(await part.text(), '%PDF-');
    assert.equal(part.headers.get('Content-Range'), `bytes 0-4/${pdf.length}`);
    const suffix = await fileRequest(path, 'student-a', { Range: 'bytes=-5' });
    assert.equal(suffix.status, 206); assert.equal(await suffix.text(), '%%EOF');
    assert.equal((await fileRequest(path, 'student-a', { Range: 'bytes=99999-' })).status, 416);
    assert.equal((await fileRequest(path, 'student-a', { Range: 'bytes=0-1,4-5' })).status, 416);
    assert.equal((await fileRequest(path, 'student-a', { Range: 'bytes=0-4', 'If-Range': '"old"' })).status, 200);
    assert.equal((await fileRequest(path, 'student-a', { 'If-None-Match': head.headers.get('ETag') })).status, 304);
    assert.equal((await fileRequest(path, null, { 'If-None-Match': head.headers.get('ETag') }, 'HEAD')).status, 401);
    await h.api('PUT', `/contents/${item.materialId}/moderation`, 'teacher-a', { action: 'hide', reason: '暂停公开资料' });
    for (const method of ['GET', 'HEAD']) {
        assert.equal((await fileRequest(path, 'student-b', { Range: 'bytes=0-4', 'If-None-Match': head.headers.get('ETag') }, method)).status, 404);
        assert.equal((await fileRequest(path, 'student-a', { 'If-None-Match': head.headers.get('ETag') }, method)).status, 304);
    }
});

test('version deletion preserves the material and comments, falls back and reverses points only once', async () => {
    await h.policy({ pointsMaterial: 40, pointsMaterialVersion: 10 });
    const first = await publish(), second = await publish({ mode: 'version', materialId: first.materialId });
    const comment = await h.api('POST', '/comments', 'student-b', { targetKind: 'material', targetId: first.materialId, body: doc('新版补充了例题') });
    assert.equal(comment.status, 201);
    const path = `/materials/${first.materialId}/versions/2`;
    assert.equal((await h.api('PUT', `${path}/moderation`, 'teacher-a', { action: 'hide', reason: 'removed feature' })).status, 404);
    assert.equal((await h.api('GET', `/moderation/materials/${first.materialId}/version-actions`, 'teacher-a')).status, 404);
    assert.equal((await h.api('DELETE', path)).status, 401);
    for (const as of ['student-b', 'teacher-b']) assert.equal((await h.api('DELETE', path, as)).status, 403);
    for (const as of ['teacher-a', 'admin']) assert.equal((await h.api('DELETE', path, as, { reason: '长'.repeat(1001) })).status, 400);
    const deleted = await h.api('DELETE', path, 'student-a');
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.data, { materialId: first.materialId, version: 2, deleted: true });
    assert.equal((await h.api('DELETE', path, 'student-a')).status, 404);
    assert.equal((await h.api('GET', path)).status, 404);
    assert.equal((await h.api('GET', `/materials/${first.materialId}?version=2`)).status, 404);
    for (const action of ['preview', 'download']) for (const method of ['GET', 'HEAD']) {
        assert.equal((await fileRequest(`${path}/${action}`, 'student-a', { Range: 'bytes=0-4', 'If-None-Match': '*' }, method)).status, 404);
    }
    assert.equal(await h.env.FILES.head(objectKeys(second.ticket.uploadId).sealed), null);
    const detail = await h.api('GET', `/materials/${first.materialId}`, 'student-a');
    assert.equal(detail.data.selectedVersion.version, 1); assert.equal(detail.data.versions.total, 1);
    assert.equal(detail.data.permissions.canDeleteVersion, false); assert.equal(detail.data.commentCount, 1);
    assert.equal(await h.database.prepare("SELECT SUM(delta_points) AS n FROM bonus_ledger WHERE student_id='student-a'").first('n'), 40);
    assert.equal(await h.database.prepare("SELECT operator_id FROM bonus_ledger ORDER BY id DESC LIMIT 1").first('operator_id'), 'student-a');

    await h.api('PUT', `/contents/${first.materialId}/moderation`, 'teacher-a', { action: 'hide', reason: '整体暂停公开' });
    assert.equal((await fileRequest(`/materials/${first.materialId}/versions/1/download`, 'student-b')).status, 404);
    assert.equal((await h.api('GET', `/moderation/materials/${first.materialId}/versions`, 'teacher-a')).data.total, 1);
    assert.equal(await h.database.prepare("SELECT SUM(delta_points) AS n FROM bonus_ledger WHERE student_id='student-a'").first('n'), 0);
    await h.api('PUT', `/contents/${first.materialId}/moderation`, 'teacher-a', { action: 'restore', reason: '整体恢复公开' });
    assert.equal(await h.database.prepare("SELECT SUM(delta_points) AS n FROM bonus_ledger WHERE student_id='student-a'").first('n'), 40);
    assert.equal((await h.api('DELETE', `/materials/${first.materialId}/versions/1`, 'student-a')).status, 409);
    const empty = await h.api('GET', `/materials/${first.materialId}`);
    assert.equal(empty.data.latestVersion.version, 1); assert.equal(empty.data.selectedVersion.version, 1); assert.equal(empty.data.versions.total, 1);
    assert.deepEqual(empty.data.body, doc('资料介绍')); assert.equal(empty.data.commentCount, 1);
    assert.equal((await h.api('GET', `/contents/${comment.data.id}`)).status, 200);
    assert.equal(await h.database.prepare("SELECT SUM(delta_points) AS n FROM bonus_ledger WHERE student_id='student-a'").first('n'), 40);
    assert.deepEqual((await h.api('POST', `/material-uploads/${second.ticket.uploadId}/confirm`, 'student-a')).data,
        { materialId: first.materialId, version: 2 });
    assert.equal((await h.api('GET', `/materials/${first.materialId}/versions`)).data.total, 1);
    assert.equal(await h.env.FILES.head(objectKeys(second.ticket.uploadId).sealed), null);
    const next = await publish({ mode: 'version', materialId: first.materialId });
    assert.equal(next.version, 3);
    await h.api('PUT', `/contents/${first.materialId}/moderation`, 'teacher-a', { action: 'hide', reason: '整体暂停公开' });
    assert.equal((await h.api('DELETE', `/materials/${first.materialId}/versions/3`, 'student-a')).status, 200);
    await h.api('PUT', `/contents/${first.materialId}/moderation`, 'teacher-a', { action: 'restore', reason: '整体恢复公开' });
    const final = await publish({ mode: 'version', materialId: first.materialId });
    assert.equal((await h.api('DELETE', `/contents/${first.materialId}`, 'student-a')).status, 409);
    assert.equal((await h.api('PUT', `/contents/${first.materialId}/moderation`, 'teacher-a', { action: 'delete', reason: '删除资料和评论' })).status, 200);
    assert.equal((await h.api('DELETE', `/materials/${first.materialId}/versions/${final.version}`, 'student-a')).status, 409);
});

test('creation drafts are temporary and version uploads accept no change notes', async () => {
    const ticket = await prepare();
    const row = await h.database.prepare('SELECT * FROM material_upload_sessions WHERE id=?').bind(ticket.uploadId).first();
    assert.deepEqual(JSON.parse(row.creation_draft), { title: '微积分讲义.pdf', body: doc('资料介绍'), tags: ['期末'] });
    assert.equal('payload' in row, false); assert.equal('change_note' in row, false);
    await put(ticket);
    const created = (await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).data;
    assert.equal(await h.database.prepare('SELECT creation_draft FROM material_upload_sessions WHERE id=?').bind(ticket.uploadId).first('creation_draft'), null);
    const version = await prepare({ mode: 'version', materialId: created.materialId });
    assert.equal(await h.database.prepare('SELECT creation_draft FROM material_upload_sessions WHERE id=?').bind(version.uploadId).first('creation_draft'), null);
    assert.equal((await h.api('POST', '/material-uploads', 'student-a', { mode: 'version', materialId: created.materialId,
        file: { size: pdf.length, type: 'application/pdf' }, changeNote: 'removed' })).status, 400);
    const cancelled = await prepare(), expired = await prepare();
    await h.api('DELETE', `/material-uploads/${cancelled.uploadId}`, 'student-a');
    assert.equal(await h.database.prepare('SELECT creation_draft FROM material_upload_sessions WHERE id=?').bind(cancelled.uploadId).first('creation_draft'), null);
    await cleanupMaterialUploads(h.env, Math.floor(Date.now() / 1000) + 100000);
    assert.equal(await h.database.prepare('SELECT creation_draft FROM material_upload_sessions WHERE id=?').bind(expired.uploadId).first('creation_draft'), null);
});

test('a failed version deletion rolls back its points and never removes the live file', async () => {
    await h.policy({ pointsMaterial: 40 });
    const item = await publish(), path = `/materials/${item.materialId}/versions/1`;
    await publish({ mode: 'version', materialId: item.materialId });
    await h.database.prepare("CREATE TRIGGER fail_delete_points BEFORE INSERT ON bonus_ledger BEGIN SELECT RAISE(ABORT,'fixture_failure'); END").run();
    assert.equal((await h.api('DELETE', path, 'student-a')).status, 500);
    assert.equal((await h.api('GET', path)).status, 200);
    assert.ok(await h.env.FILES.head(objectKeys(item.ticket.uploadId).sealed));
    assert.equal(await h.database.prepare('SELECT updated_by FROM file_versions WHERE material_id=?').bind(item.materialId).first('updated_by'), 'student-a');
    assert.equal(await h.database.prepare("SELECT SUM(delta_points) AS n FROM bonus_ledger WHERE student_id='student-a'").first('n'), 40);
    await h.database.prepare('DROP TRIGGER fail_delete_points').run();
    assert.equal((await h.api('DELETE', path, 'student-a')).status, 200);
});

test('deleted version files are eventually cleaned after an R2 failure or a lost database response', async () => {
    const live = await publish();
    for (const failure of ['storage', 'response']) {
        const item = await publish({ mode: 'version', materialId: live.materialId });
        const database = h.env.DB, bucket = h.env.FILES;
        if (failure === 'storage') h.env.FILES = new Proxy(bucket, { get(target, key) {
            if (key === 'delete') return async () => { throw new Error('fixture R2 unavailable'); };
            const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
        } });
        else h.env.DB = new Proxy(database, { get(target, key) {
            if (key === 'batch') return async (...args) => { await target.batch(...args); throw new Error('fixture lost response'); };
            const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
        } });
        const path = `/materials/${item.materialId}/versions/${item.version}`;
        assert.equal((await h.api('DELETE', path, 'student-a')).status, failure === 'storage' ? 200 : 500);
        h.env.DB = database; h.env.FILES = bucket;
        assert.equal((await h.api('GET', path)).status, 404);
        assert.ok(await bucket.head(objectKeys(item.ticket.uploadId).sealed));
        assert.equal((await h.api('DELETE', path, 'student-a')).status, 404);
        await cleanupMaterialUploads(h.env, Math.floor(Date.now() / 1000) + 100000);
        assert.equal(await bucket.head(objectKeys(item.ticket.uploadId).sealed), null);
        assert.ok(await bucket.head(objectKeys(live.ticket.uploadId).sealed));
    }
});

test('version deletion rechecks the actor in the final database transaction', async () => {
    const item = await publish(), database = h.env.DB;
    await publish({ mode: 'version', materialId: item.materialId });
    h.env.DB = new Proxy(database, { get(target, key) {
        if (key === 'batch') return async (...args) => {
            await target.prepare("UPDATE accounts SET status='deleted' WHERE id='student-a'").run();
            return target.batch(...args);
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    assert.equal((await h.api('DELETE', `/materials/${item.materialId}/versions/1`, 'student-a')).status, 404);
    h.env.DB = database;
    assert.equal((await h.api('GET', `/materials/${item.materialId}/versions/1`)).status, 200);
    assert.ok(await h.env.FILES.head(objectKeys(item.ticket.uploadId).sealed));
});

test('failed publication rolls back metadata and points, retaining the sealed file for a safe retry', async () => {
    await h.policy({ pointsMaterial: 40 });
    const ticket = await prepare(); await put(ticket);
    await h.database.prepare("CREATE TRIGGER fail_material_points BEFORE INSERT ON bonus_ledger BEGIN SELECT RAISE(ABORT,'fixture_failure'); END").run();
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 500);
    const state = await h.database.prepare('SELECT * FROM material_upload_sessions WHERE id=?').bind(ticket.uploadId).first();
    assert.equal(state.status, 'pending');
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM contents WHERE id=?').bind(state.material_id).first('n'), 0);
    assert.ok(await h.env.FILES.head(objectKeys(ticket.uploadId).sealed));
    await h.database.prepare('DROP TRIGGER fail_material_points').run();
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 200);
    assert.equal(await h.database.prepare("SELECT SUM(delta_points) AS n FROM bonus_ledger WHERE student_id='student-a'").first('n'), 40);
});

test('a lost database response is recoverable without deleting or republishing the committed version', async () => {
    const ticket = await prepare(); await put(ticket);
    const original = h.env.DB;
    h.env.DB = new Proxy(original, { get(target, key) {
        if (key === 'batch') return async (...args) => { await target.batch(...args); throw new Error('fixture lost response'); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 500);
    h.env.DB = original;
    const recovered = await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a');
    assert.equal(recovered.status, 200);
    assert.ok(await h.env.FILES.head(objectKeys(ticket.uploadId).sealed));
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM file_versions WHERE material_id=?').bind(recovered.data.materialId).first('n'), 1);
});

test('deletion during file sealing blocks publication in the final transaction', async () => {
    const originalFile = await publish(), ticket = await prepare({ mode: 'version', materialId: originalFile.materialId });
    await put(ticket);
    const bucket = h.env.FILES;
    h.env.FILES = new Proxy(bucket, { get(target, key) {
        if (key === 'put') return async (...args) => {
            await h.database.prepare("UPDATE contents SET status='deleted',title=NULL,body=NULL,tags=NULL,updated_by='student-a' WHERE id=?").bind(originalFile.materialId).run();
            return target.put(...args);
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 409);
    h.env.FILES = bucket;
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM file_versions WHERE material_id=?').bind(originalFile.materialId).first('n'), 0);
    assert.equal((await h.api('PUT', `/contents/${originalFile.materialId}/moderation`, 'teacher-a', { action: 'restore', reason: '恢复资料公开' })).status, 409);
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 404);
});

test('cancelled and expired uploads are cleaned while published files remain and late PUT remnants are revisited', async () => {
    const published = await publish(), cancelled = await prepare(), expired = await prepare();
    await put(cancelled); await put(expired);
    assert.equal((await h.api('DELETE', `/material-uploads/${cancelled.uploadId}`, 'student-a')).status, 200);
    assert.equal((await h.api('POST', `/material-uploads/${cancelled.uploadId}/confirm`, 'student-a')).status, 409);
    assert.equal((await h.api('DELETE', `/material-uploads/${published.ticket.uploadId}`, 'student-a')).status, 409);
    const future = Math.floor(Date.now() / 1000) + 100000;
    assert.equal((await cleanupMaterialUploads(h.env, future)).cleaned, 3);
    assert.equal(await h.env.FILES.head(objectKeys(cancelled.uploadId).staging), null);
    assert.equal(await h.env.FILES.head(objectKeys(expired.uploadId).staging), null);
    assert.ok(await h.env.FILES.head(objectKeys(published.ticket.uploadId).sealed));
    assert.equal((await h.api('POST', `/material-uploads/${expired.uploadId}/confirm`, 'student-a')).status, 410);
    await h.env.FILES.put(objectKeys(expired.uploadId).staging, pdf);
    await cleanupMaterialUploads(h.env, future + 86401);
    assert.equal(await h.env.FILES.head(objectKeys(expired.uploadId).staging), null);
});

test('ZIP is download-only and production tickets sign an opaque staging key with a restricted type', async () => {
    const zip = new Uint8Array([80, 75, 5, 6, ...new Array(18).fill(0)]);
    const item = await publish({ title: '课件.zip', file: { size: zip.length, type: 'application/zip' } }, 'student-a', zip);
    assert.equal((await h.api('GET', `/materials/${item.materialId}`)).data.selectedVersion.previewUrl, null);
    assert.equal((await fileRequest(`/materials/${item.materialId}/versions/1/preview`)).status, 415);
    assert.equal((await fileRequest(`/materials/${item.materialId}/versions/1/download`)).status, 200);
    h.env.APP_ENV = 'production';
    assert.equal((await h.api('POST', '/material-uploads', 'student-a', { mode: 'version', materialId: item.materialId, file: { size: pdf.length, type: 'application/pdf' } })).status, 503);
    Object.assign(h.env, { R2_ACCOUNT_ID: '0'.repeat(32), R2_BUCKET_NAME: 'fixture-private-bucket', R2_ACCESS_KEY_ID: 'fictional-access-key', R2_SECRET_ACCESS_KEY: 'fictional-secret-only-for-tests' });
    const ticket = await prepare({ mode: 'version', materialId: item.materialId });
    const url = new URL(ticket.url);
    assert.equal(url.hostname, `${'0'.repeat(32)}.r2.cloudflarestorage.com`);
    assert.equal(url.pathname, `/fixture-private-bucket/materials/staging/${ticket.uploadId}`);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
    assert.equal(ticket.url.includes(h.env.R2_SECRET_ACCESS_KEY), false);
    const localPath = `http://localhost/api/local/material-uploads/${ticket.uploadId}/file`;
    assert.equal((await put({ ...ticket, url: localPath })).status, 404);
});

test('an expired PUT ticket can be renewed and an abandoned confirmation lease can be recovered', async () => {
    const options = { key: 'refresh-upload-ticket' };
    const ticket = await prepare({}, 'student-a', options);
    await h.database.prepare('UPDATE material_upload_sessions SET put_expires_at=unixepoch()-1 WHERE id=?').bind(ticket.uploadId).run();
    assert.equal((await put(ticket)).status, 410);
    const renewed = await prepare({}, 'student-a', options);
    assert.equal(renewed.uploadId, ticket.uploadId); assert.equal((await put(renewed)).status, 204);
    await h.database.prepare("UPDATE material_upload_sessions SET status='confirming',lease_token='fixture-lease',lease_until=unixepoch()+300 WHERE id=?").bind(ticket.uploadId).run();
    assert.equal((await h.api('DELETE', `/material-uploads/${ticket.uploadId}`, 'student-a')).status, 409);
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 409);
    await h.database.prepare('UPDATE material_upload_sessions SET lease_until=unixepoch()-1 WHERE id=?').bind(ticket.uploadId).run();
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 200);
});

test('a confirmation that loses its lease cannot publish or reset the replacement lease', async () => {
    const ticket = await prepare(); await put(ticket);
    const bucket = h.env.FILES;
    h.env.FILES = new Proxy(bucket, { get(target, key) {
        if (key === 'put') return async (...args) => {
            const result = await target.put(...args);
            await h.database.prepare("UPDATE material_upload_sessions SET lease_token='replacement-lease' WHERE id=?").bind(ticket.uploadId).run();
            return result;
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 409);
    h.env.FILES = bucket;
    const row = await h.database.prepare('SELECT * FROM material_upload_sessions WHERE id=?').bind(ticket.uploadId).first();
    assert.equal(row.status, 'confirming'); assert.equal(row.lease_token, 'replacement-lease');
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM contents WHERE id=?').bind(row.material_id).first('n'), 0);
    await h.database.prepare('UPDATE material_upload_sessions SET lease_until=unixepoch()-1 WHERE id=?').bind(ticket.uploadId).run();
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 200);
});

test('identity deletion during sealing prevents the admitted upload from publishing', async () => {
    const ticket = await prepare(); await put(ticket);
    const bucket = h.env.FILES;
    h.env.FILES = new Proxy(bucket, { get(target, key) {
        if (key === 'put') return async (...args) => {
            await h.database.prepare("UPDATE accounts SET status='deleted' WHERE id='student-a'").run();
            return target.put(...args);
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    assert.equal((await h.api('POST', `/material-uploads/${ticket.uploadId}/confirm`, 'student-a')).status, 409);
    h.env.FILES = bucket;
    const row = await h.database.prepare('SELECT * FROM material_upload_sessions WHERE id=?').bind(ticket.uploadId).first();
    assert.equal(row.status, 'pending');
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM contents WHERE id=?').bind(row.material_id).first('n'), 0);
});

test('course URLs preserve Unicode, separators and UUID-like course numbers exactly', async () => {
    for (const id of ['课程/资料 01', '12345678-abcd-abcd-abcd-123456789012', '12345678abcdabcdabcd123456789012']) {
        const course = await h.api('POST', '/courses', 'admin', { name: '文件接口课程', id, introduction: '' });
        assert.equal(course.status, 201, JSON.stringify(course.data));
        const path = `/courses/${encodeURIComponent(id)}`;
        const entry = await h.api('GET', `${path}/entry`);
        assert.equal(entry.data.links.contents, `/api${path}/contents`);
        for (const link of [entry.data.links.contents, entry.data.links.materials]) {
            const list = await h.api('GET', link.slice(4));
            assert.equal(list.status, 200); assert.equal(list.data.total, 0);
        }
    }
});

test('owners can upload versions while hidden, while managers only review and restoration recomputes every live version', async () => {
    await h.policy({ pointsMaterial: 40, pointsMaterialVersion: 10 });
    const first = await publish();
    await h.api('PUT', `/contents/${first.materialId}/moderation`, 'teacher-a', { action: 'hide', reason: '等待作者更新文件' });
    const second = await publish({ mode: 'version', materialId: first.materialId });
    assert.equal(second.version, 2);
    const own = await h.api('GET', `/materials/${first.materialId}`, 'student-a');
    assert.equal(own.data.status, 'hidden'); assert.equal(own.data.selectedVersion.version, 2);
    assert.equal((await h.api('GET', `/materials/${first.materialId}`, 'teacher-a')).status, 404);
    assert.equal(await h.database.prepare("SELECT SUM(delta_points) AS n FROM bonus_ledger WHERE student_id='student-a'").first('n'), 0);
    const versions = await h.api('GET', `/moderation/materials/${first.materialId}/versions`, 'teacher-a');
    const reviewPath = versions.data.items[0].previewUrl.replace('/api', '');
    assert.equal((await fileRequest(reviewPath, 'teacher-a')).status, 200);
    assert.equal((await fileRequest(reviewPath, 'student-b')).status, 403);
    await h.policy({ pointsMaterial: 60, pointsMaterialVersion: 20 });
    assert.equal((await h.api('PUT', `/contents/${first.materialId}/moderation`, 'teacher-a', { action: 'restore', reason: '新版复核通过' })).status, 200);
    assert.equal(await h.database.prepare("SELECT SUM(delta_points) AS n FROM bonus_ledger WHERE student_id='student-a'").first('n'), 80);
});