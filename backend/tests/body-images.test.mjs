import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { start, tokenFor } from './discussions-helpers.mjs';
import { cleanupBodyImages } from '../src/body-images.ts';
import { cleanupMaterialUploads } from '../src/materials/cleanup.ts';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmS8AAAAASUVORK5CYII=', 'base64');
const headers = who => who ? { Cookie: `coursestack_session=${tokenFor(who)}` } : {};
const post = (bytes, mime = 'image/png', who = 'student-a') => h.worker.fetch('http://localhost/api/body-images',
    { method: 'POST', headers: { ...headers(who), Origin: 'http://localhost', 'Content-Type': mime,
        'Content-Length': String(bytes.byteLength) }, body: bytes });
async function upload() {
    const response = await post(png);
    assert.equal(response.status, 200);
    const { src } = (await response.json()).data;
    assert.match(src, /^\/api\/body-images\/[0-9a-f]{32}$/);
    return src;
}
const image = src => ({ type: 'image', attrs: { src, alt: '图片' } });
const body = (...urls) => ({ type: 'doc', content: urls.map(image) });
const read = (src, who) => h.worker.fetch('http://localhost' + src, { headers: headers(who) });
const id = src => src.split('/').at(-1);
const record = src => h.database.prepare('SELECT * FROM content_images WHERE id=?').bind(id(src)).first();
const object = src => h.env.FILES.head('body-images/' + id(src));
const edit = (q, value) => h.api('PATCH', '/contents/' + q, 'student-a', { body: value });

test('raw uploads require login, validate file bytes and enforce the 1 MiB limit on uploads', async () => {
    assert.equal((await post(png, 'image/png', null)).status, 401);
    assert.equal((await post(png, 'image/gif')).status, 415);
    assert.equal((await post(Buffer.from('<svg/>'), 'image/svg+xml')).status, 415);
    const oneMiB = 1024 * 1024;
    const bytes = Buffer.alloc(oneMiB + 1);
    png.copy(bytes);
    assert.equal((await post(bytes)).status, 413);
    const over = new ReadableStream({ start(controller) {
        controller.enqueue(bytes.subarray(0, oneMiB)); controller.enqueue(bytes.subarray(oneMiB)); controller.close();
    } });
    const response = await h.worker.fetch('http://localhost/api/body-images', { method: 'POST', duplex: 'half',
        headers: { ...headers('student-a'), Origin: 'http://localhost', 'Content-Type': 'image/png' }, body: over });
    assert.equal(response.status, 413);
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM content_images').first('n'), 0);
    const exact = await post(bytes.subarray(0, oneMiB));
    assert.equal(exact.status, 200);
    const src = (await exact.json()).data.src;
    for (const viewer of [null,'student-b','admin']) assert.equal((await read(src, viewer)).status, 404);
    const mine = await read(src, 'student-a');
    assert.equal(mine.headers.get('content-type'), 'image/png');
    assert.equal((await mine.arrayBuffer()).byteLength, oneMiB);
});

test('independent binaries attach and detach atomically with edits, moderation and whole-branch deletion', async () => {
    const a = await upload(), b = await upload(), c = await upload();
    assert.notEqual(a,b);
    const external = 'https://example.com/large.png?v=1';
    const q = await h.postQuestion('student-a', { body: body(a, b, external) });
    assert.equal((await record(a)).content_id, q);
    assert.equal((await read(a)).status, 200);
    const answer = await h.postAnswer(q, 'student-a', body(c));
    assert.equal((await record(c)).content_id, answer);
    const bad = await edit(q, body(b, c));
    assert.equal(bad.status, 409);
    assert.equal((await record(a)).content_id, q);
    assert.deepEqual((await h.api('GET', '/questions/'+q)).data.body, body(a,b,external));
    assert.equal((await edit(q, body(a,'http://localhost'+a+'?x=1'))).status, 409);
    assert.equal((await edit(q, body('http://localhost'+b+'?v=1', external))).status, 200);
    assert.deepEqual((await h.api('GET', '/questions/'+q)).data.body, body(b,external));
    assert.equal((await record(a)).content_id, null);
    assert.equal((await read(a,'student-a')).status, 404);
    assert.equal((await edit(q, body(a))).status, 409);
    await cleanupBodyImages(h.env);
    assert.equal(await object(a), null);
    assert.equal(await record(a), null);
    assert.ok(await object(b));
    for (const [action,status] of [['hide',404],['restore',200],['delete',404]]) {
        assert.equal((await h.api('PUT','/contents/'+q+'/moderation','admin',{action})).status, 200);
        assert.equal((await read(b)).status, status);
        assert.equal((await read(c)).status, status);
        if (action === 'hide') {
            assert.equal((await read(c,'visitor')).status, 404);
            assert.equal((await read(b,'student-a')).status, 200);
            assert.equal((await read(c,'teacher-a')).status, 200);
            await cleanupBodyImages(h.env); assert.ok(await object(c));
        }
    }
    await cleanupBodyImages(h.env);
    assert.equal(await object(b), null); assert.equal(await object(c), null);
    assert.deepEqual((await h.database.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('a temporary binary can be claimed only by its uploader and only one concurrent publication', async () => {
    const src = await upload(), create = (who,key) => h.api('POST','/courses/course-a/questions',who,{ title:'图', body:body(src) },{key});
    assert.equal((await create('student-b','foreign-image')).status,409);
    const results = await Promise.all(['attempt-01','attempt-02'].map(key => create('student-a',key)));
    assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
    const index = results.findIndex(r => r.status === 201);
    const replay = await create('student-a',index ? 'attempt-02' : 'attempt-01');
    assert.equal(replay.data.id, results[index].data.id);
    const orphan = await upload();
    await h.database.prepare('UPDATE content_images SET cleanup_at=unixepoch()-1 WHERE id=?').bind(id(orphan)).run();
    await cleanupBodyImages({ ...h.env, FILES: { delete: async () => { throw Error('temporary failure'); } } });
    assert.ok(await object(orphan)); assert.ok(await record(orphan));
    assert.equal((await read(orphan,'student-a')).status,404);
    await cleanupBodyImages(h.env); assert.equal(await object(orphan),null); assert.ok(await object(src));
});

test('material drafts hold images through file confirmation and release them on cancellation or expiry', async () => {
    const pdf = Buffer.from('%PDF-1.7 body image fixture');
    for (const end of ['publish','cancel','expire']) {
        const src = await upload();
        const ticket = await h.api('POST','/material-uploads','student-a',{
            mode:'create', courseId:'course-a', title:end+'.pdf', body:body(src), file:{type:'application/pdf',size:pdf.length}
        });
        assert.equal(ticket.status,201,JSON.stringify(ticket.data));
        const { uploadId, url } = ticket.data;
        assert.equal((await record(src)).draft_upload_id,uploadId);
        assert.equal((await record(src)).cleanup_at,null);
        const hijack = await h.api('POST','/courses/course-a/questions','student-a',{ title:'冲突',body:body(src) });
        assert.equal(hijack.status,409);
        if (end === 'publish') {
            assert.equal((await h.worker.fetch(url,{method:'PUT',headers:{...ticket.data.headers,...headers('student-a'),Origin:'http://localhost'},body:pdf})).status,204);
            const confirmed = await h.api('POST','/material-uploads/'+uploadId+'/confirm','student-a');
            assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
            assert.equal((await record(src)).content_id,confirmed.data.materialId);
            assert.equal((await record(src)).draft_upload_id,null);
            assert.equal((await read(src)).status,200);
        } else {
            if (end === 'cancel') assert.equal((await h.api('DELETE','/material-uploads/'+uploadId,'student-a')).status,200);
            else {
                await h.database.prepare('UPDATE material_upload_sessions SET expires_at=unixepoch()-1 WHERE id=?').bind(uploadId).run();
                await cleanupMaterialUploads(h.env);
            }
            assert.equal((await record(src)).draft_upload_id,null);
            await cleanupBodyImages(h.env); assert.equal(await object(src),null);
        }
    }
});