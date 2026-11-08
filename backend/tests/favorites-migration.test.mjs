import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readMigrations } from '../scripts/lib/migrations.mjs';

test('favorites upgrade preserves old inbox IDs and reads, backfills only verifiable feed events without delivering history', async () => {
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21', d1Databases: ['DB'] }));
    try {
        const db = await runtime.getD1Database('DB'), migrations = await readMigrations();
        const index = migrations.findIndex(m => m.name === '0010_favorites.sql');
        assert.ok(index > 0);
        for (const migration of migrations.slice(0, index)) await db.batch(migration.statements.map(s => db.prepare(s)));
        const fixture = `
            INSERT INTO accounts(id,role,school_number) VALUES('admin','admin',NULL),('a','student','A'),('b','student','B');
            INSERT INTO courses(id,name,created_by,request_key,request_hash) VALUES('COURSE','课程','admin','course-key','hash');
            INSERT INTO contents(id,kind,course_id,author_id,title,updated_by,request_key,request_hash,created_at)
              VALUES('q','question','COURSE','a','历史问题','a','question-key','hash',100),
                    ('m','material','COURSE','b','历史资料','b','material-key','hash',101);
            INSERT INTO contents(id,kind,course_id,author_id,target_id,updated_by,request_key,request_hash,created_at)
              VALUES('answer','answer','COURSE','b','q','b','answer-key','hash',102);
            INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by,created_at)
              VALUES('m',1,'old/1',10,'application/pdf','b','b',101),('m',2,'old/2',10,'application/pdf','b','b',103);
            UPDATE notifications SET read_at=104;
        `;
        await db.batch(fixture.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
        const before = (await db.prepare('SELECT * FROM notifications').all()).results;
        assert.equal(before.length, 1);
        for (const migration of migrations.slice(index)) await db.batch(migration.statements.map(s => db.prepare(s)));
        const after = (await db.prepare('SELECT * FROM notifications').all()).results;
        assert.deepEqual(after.map(({ event_id, ...row }) => row), before);
        assert.ok(after.every(row => row.event_id === null));
        assert.deepEqual((await db.prepare('SELECT kind,created_at FROM content_events ORDER BY created_at').all()).results,
            [{ kind: 'question_created', created_at: 100 }, { kind: 'material_created', created_at: 101 }, { kind: 'material_version', created_at: 103 }]);
        assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
        await db.prepare("INSERT INTO favorites(account_id,content_id) VALUES('a','m')").run();
        assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notifications').first()).n, 1);
        await db.prepare("INSERT INTO file_versions(material_id,version,storage_key,size,mime,uploaded_by,updated_by) VALUES('m',3,'new/3',10,'application/pdf','b','b')").run();
        assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notifications').first()).n, 2);
    } finally { await runtime.dispose(); }
});