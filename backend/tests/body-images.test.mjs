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

for (const mode of ['default', 'OFF', 'ON']) for (const hideFirst of [false, true]) {
    test(`three-level cascade clears search text, releases images and reverses awards once (${mode}, ${hideFirst ? 'hide then delete' : 'direct delete'})`, async () => {
        const pragma = () => h.database.prepare('PRAGMA recursive_triggers').first('recursive_triggers');
        if (mode !== 'default') await h.database.prepare('PRAGMA recursive_triggers=' + mode).run();
        const setting = await pragma();
        if (mode !== 'default') assert.equal(setting, mode === 'ON' ? 1 : 0);
        await h.policy({ pointsQuestion: 1, pointsAnswer: 2, pointsComment: 4 });
        const withImage = (text, src) => ({ type: 'doc', content: [
            { type: 'paragraph', content: [{ type: 'text', text }] }, image(src),
        ] });
        const sources = [await upload(), await upload(), await upload()];
        const question = await h.postQuestion('student-a', { body: withImage('question', sources[0]) });
        const answer = await h.postAnswer(question, 'student-a', withImage('answer', sources[1]));
        const comment = await h.api('POST', '/comments', 'student-a', { targetKind: 'answer', targetId: answer, body: withImage('comment', sources[2]) });
        assert.equal(comment.status, 201);
        // Comments normally have no search text. Seed a sentinel to exercise the deletion trigger at this level.
        await h.database.prepare('UPDATE contents SET body_text=? WHERE id=?').bind('comment', comment.data.id).run();
        const ids = [question, answer, comment.data.id];
        const branch = async () => (await h.database.prepare('SELECT id,status,title,body,tags,body_text FROM contents WHERE id IN (?,?,?)')
            .bind(...ids).all()).results;
        const ledger = async () => (await h.database.prepare('SELECT id,source_id,delta_points,reverses_id FROM bonus_ledger WHERE source_id IN (?,?,?) ORDER BY id')
            .bind(...ids).all()).results;
        const original = await ledger();
        assert.deepEqual(original.map(row => [row.source_id, row.delta_points, row.reverses_id]),
            [[question, 1, null], [answer, 2, null], [comment.data.id, 4, null]]);
        async function assertReversed() {
            const rows = await ledger();
            assert.equal(rows.length, 6);
            for (const award of original) {
                assert.deepEqual(rows.filter(row => row.source_id === award.source_id).map(row => [row.delta_points, row.reverses_id]),
                    [[award.delta_points, null], [-award.delta_points, award.id]]);
            }
        }
        const assertAttached = async () => {
            for (const [index, src] of sources.entries()) {
                const row = await record(src);
                assert.equal(row.content_id, ids[index]);
                assert.equal(row.cleanup_at, null);
            }
        };
        const before = await branch();
        assert.equal(before.length, 3);
        assert.ok(before.every(row => row.status === 'visible' && row.body_text.length > 0));
        await assertAttached();
        const moderate = action => h.api('PUT', '/contents/' + question + '/moderation', 'teacher-a', { action });
        if (hideFirst) {
            assert.equal((await moderate('hide')).status, 200);
            await assertReversed();
            await assertAttached();
            assert.ok((await branch()).every(row => row.body_text.length > 0));
            assert.equal(await h.database.prepare('SELECT count(*) AS n FROM public_contents WHERE id IN (?,?,?)').bind(...ids).first('n'), 0);
        }
        const deleteAt = Math.floor(Date.now() / 1000);
        assert.equal((await moderate('delete')).status, 200);
        const after = await branch();
        assert.equal(after.length, 3);
        assert.ok(after.every(row => row.status === 'deleted' && row.title === null && row.body === null && row.tags === null && row.body_text === ''));
        await assertReversed();
        for (const src of sources) {
            const row = await record(src);
            assert.equal(row.content_id, null);
            assert.equal(row.draft_upload_id, null);
            assert.ok(row.cleanup_at >= deleteAt && row.cleanup_at <= Math.floor(Date.now() / 1000));
            assert.equal((await read(src)).status, 404);
            assert.ok(await object(src));
        }
        await cleanupBodyImages(h.env);
        for (const src of sources) {
            assert.equal(await object(src), null);
            assert.equal(await record(src), null);
        }
        assert.equal(await pragma(), setting);
    });
}

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