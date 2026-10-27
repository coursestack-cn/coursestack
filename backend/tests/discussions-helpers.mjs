import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from '../src/index.ts';
import { digest } from '../src/auth/crypto.ts';
import { readMigrations } from '../scripts/lib/migrations.mjs';

export const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] });
export const linkDoc = (text, href) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }] }] });
export const internalToken = 'fictional-test-internal-service-token';
export const tokenFor = id => Buffer.from(id).toString('hex').padEnd(64, '0');
const fixture = `
PRAGMA defer_foreign_keys=ON;
INSERT INTO accounts(id,nickname,role,name) VALUES ('student-a','学习者甲','student','虚构甲'),('student-b','学习者乙','student','虚构乙'),
('visitor','旁听者','student','虚构丙'),('teacher-a','数学教师','teacher','虚构教师甲'),('teacher-b','物理教师','teacher','虚构教师乙'),('admin','管理员','admin',NULL);
INSERT INTO terms(id,name,current) VALUES ('term-active','当前学期',0),('term-old','历史学期',1);
INSERT INTO enrollments(course_id,account_id,term_id) VALUES ('course-a','teacher-b','term-old');
UPDATE terms SET current=0;
UPDATE terms SET current=1 WHERE id='term-active';
INSERT INTO enrollments(course_id,account_id,term_id) VALUES ('course-a','teacher-a','term-active'),('course-b','teacher-b','term-active');
INSERT INTO courses(id,name,code,created_by,updated_by,created_at,updated_at,request_key,request_hash) VALUES
 ('course-a','高等数学','MATH101','teacher-a','teacher-a',1792540800,1792540800,'fixture-course-a','fixture'),
 ('course-b','大学物理','PHYS101','teacher-b','teacher-b',1792540800,1792540800,'fixture-course-b','fixture');
INSERT INTO enrollments(course_id,account_id,term_id) VALUES ('course-a','student-a','term-active'),('course-a','student-b','term-active'),('course-b','student-b','term-active'),('course-a','visitor','term-old');
INSERT INTO contents(id,kind,course_id,author_id,title,body,updated_by,request_key,request_hash) VALUES ('material-a','material','course-a','student-a','微积分讲义',NULL,'student-a','fixture-material-a','fixture'),('material-b','material','course-b','teacher-b','物理讲义',NULL,'teacher-b','fixture-material-b','fixture');
INSERT INTO file_versions(material_id,version,filename,status,uploaded_by,updated_by) VALUES
('material-a',1,'微积分-v1.pdf','visible','student-a','student-a'),('material-a',2,'微积分-v2.pdf','visible','student-a','student-a'),
('material-a',3,'内部版本.pdf','hidden','student-a','student-a'),('material-b',1,'物理-v1.pdf','visible','teacher-b','teacher-b');
`;

export async function setCurrentTerm(db, id) {
    await db.batch([db.prepare('UPDATE terms SET current=0 WHERE current=1'),
        db.prepare('UPDATE terms SET current=1 WHERE id=?').bind(id)]);
}

export async function start(options = {}) {
    const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
        script: 'export default { fetch() { return new Response("test"); } };',
        compatibilityDate: '2026-10-21', d1Databases: ['DB'], r2Buckets: ['FILES'],
    }));
    try {
        const database = await mf.getD1Database('DB');
        const env = { DB: database, FILES: await mf.getR2Bucket('FILES'), APP_ENV: options.appEnv ?? 'local',
            INTERNAL_API_TOKEN: options.internalToken ?? internalToken };
        for (const { statements } of await readMigrations()) await database.batch(statements.map(s => database.prepare(s)));
        await database.batch(fixture.split(';').filter(s => s.trim()).map(s => database.prepare(s)));
        for (const id of ['student-a', 'student-b', 'visitor', 'teacher-a', 'teacher-b', 'admin']) {
            await database.batch([
                database.prepare('UPDATE accounts SET school_number=?, password=? WHERE id=?')
                    .bind(id === 'admin' ? null : id, 'fictional-unusable-password-hash', id),
                database.prepare('INSERT INTO sessions(token_hash,account_id,credential_version,expires_at) VALUES (?,?,1,unixepoch()+3600)')
                    .bind(await digest(tokenFor(id)), id),
            ]);
        }
        const fetch = (url, init) => worker.fetch(new Request(url, init), env);
        async function api(method, path, as, data, opts = {}) {
            const response = await fetch(`http://localhost/api${path}`, {
                method, headers: {
                    Origin: 'http://localhost',
                    ...(as ? { Cookie: `coursestack_session=${tokenFor(as)}` } : {}),
                    ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
                    ...(method === 'POST' && !opts.internal ? { 'Idempotency-Key': opts.key ?? crypto.randomUUID() } : {}),
                    ...opts.headers,
                },
                ...(data === undefined ? {} : { body: JSON.stringify(data) }),
            });
            const payload = await response.json();
            if (response.ok) assert.ok(Object.hasOwn(payload, 'data'), 'success must use the main response envelope');
            return { status: response.status, data: response.ok ? payload.data : payload, headers: response.headers, payload };
        }
        async function postQuestion(as = 'student-a', extra = {}, course = 'course-a') {
            const response = await api('POST', `/courses/${course}/questions`, as, { title: '极限如何计算？', body: doc('求解极限。'), ...extra });
            assert.equal(response.status, 201, JSON.stringify(response.data)); return response.data.id;
        }
        async function postAnswer(question, as = 'student-b', body = doc('利用夹逼定理，极限为1。')) {
            const response = await api('POST', `/questions/${question}/answers`, as, { body });
            assert.equal(response.status, 201, JSON.stringify(response.data)); return response.data.id;
        }
        const accept = async (question, answer, as = 'teacher-a') => api('PUT', `/questions/${question}/acceptance`, as,
            { answerId: answer });
        async function policy(rules = { pointsAcceptance: 50 }) {
            const response = await api('PUT', '/courses/course-a/bonus-policy', 'teacher-a', { pointsQuestion: 0, pointsAnswer: 0, pointsAcceptance: 0, pointsComment: 0, pointsMaterial: 0, pointsMaterialVersion: 0, ...rules });
            assert.equal(response.status, 200, JSON.stringify(response.data)); return response;
        }
        return { mf, database, env, worker: { fetch }, api, postQuestion, postAnswer, accept, policy, dispose: () => mf.dispose() };
    } catch (error) { await mf.dispose(); throw error; }
}