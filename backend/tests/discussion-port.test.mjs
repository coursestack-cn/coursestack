import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { start, setCurrentTerm, internalToken, tokenFor } from './discussions-helpers.mjs';
import { digest } from '../src/auth/crypto.ts';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });

// Revoke authority after route preflight reads but before its first SQL write.
// This exercises the write predicates, rather than merely testing middleware.
function beforeWrite(pattern, change) {
    const originals = new WeakMap();
    let fired = false;
    const intercept = async sql => {
        if (!fired && pattern.test(sql)) { fired = true; await change(); }
    };
    const wrap = (statement, sql) => {
        const proxy = new Proxy(statement, { get(target, name) {
            if (name === 'bind') return (...values) => wrap(target.bind(...values), sql);
            if (['run', 'all', 'raw', 'first'].includes(name)) return async (...args) => {
                await intercept(sql); return target[name](...args);
            };
            const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
        } });
        originals.set(proxy, { statement, sql });
        return proxy;
    };
    h.env.DB = new Proxy(h.database, { get(target, name) {
        if (name === 'prepare') return sql => wrap(target.prepare(sql), sql);
        if (name === 'batch') return async statements => {
            for (const statement of statements) await intercept(originals.get(statement)?.sql ?? '');
            return target.batch(statements.map(s => originals.get(s)?.statement ?? s));
        };
        const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    return () => assert.ok(fired, 'the mutation race hook must execute');
}

test('health and unknown API preserve the main response contract', async () => {
    const health = await h.api('GET', '/health');
    assert.equal(health.status, 200); assert.equal(health.data.database, 'ok');
    const missing = await h.api('GET', '/this-api-does-not-exist?x=1');
    assert.equal(missing.status, 404); assert.equal(missing.data.error.code, 'NOT_FOUND');
});

test('local seed is repeatable without changing accounts, current term or edited courses', async () => {
    const seed = await readFile(new URL('../seed/local.sql', import.meta.url), 'utf8');
    const statements = seed.replace(/^--.*$/gm, '').split(';').filter(s => s.trim());
    const apply = () => h.database.batch(statements.map(s => h.database.prepare(s)));
    await apply();
    await h.database.prepare("UPDATE courses SET name='本地修改' WHERE id='demo-course'").run();
    await apply();
    assert.equal(await h.database.prepare("SELECT name FROM courses WHERE id='demo-course'").first('name'), '本地修改');
    assert.equal(await h.database.prepare('SELECT id FROM terms WHERE current=1').first('id'), 'term-active');
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id LIKE 'demo-%' AND password IS NOT NULL").first('n'), 0);
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM file_versions WHERE material_id='demo-material'").first('n'), 2);
    assert.deepEqual((await h.database.prepare("SELECT type,content_id FROM business_events WHERE course_id='demo-course'").all()).results,
        [{ type: 'material.created', content_id: 'demo-material' }]);
});

test('ordinary routes require Cookie and same-origin writes; service Bearer stays internal', async () => {
    const body = { title: '登录边界', body: '正文' };
    for (const bearer of [tokenFor('student-a'), internalToken]) {
        const r = await h.api('POST', '/courses/course-a/questions', undefined, body, { headers: { Authorization: `Bearer ${bearer}` } });
        assert.equal(r.status, 401); assert.equal(r.data.error.code, 'AUTH_REQUIRED');
    }
    for (const Origin of ['', 'https://foreign.example']) {
        assert.equal((await h.api('POST', '/courses/course-a/questions', 'student-a', body, { headers: { Origin } })).status, 403);
    }
    assert.equal((await h.api('GET', '/internal/events', 'admin')).status, 401);
    assert.equal((await h.api('POST', '/internal/events/ack', undefined, { eventIds: ['missing'] },
        { internal: true, headers: { Authorization: `Bearer ${internalToken}`, Origin: '' } })).status, 200);
    h.env.INTERNAL_API_TOKEN = '';
    assert.equal((await h.api('GET', '/internal/events')).status, 503);
    for (const path of ['/local/session', '/local/versions']) assert.equal((await h.api('GET', path)).status, 404);
});

test('normal accounts have exactly one identity and administrators cannot combine roles', async () => {
    for (const [id, role] of [['student-a', 'teacher'], ['teacher-a', 'student'], ['admin', 'teacher']]) {
        await assert.rejects(() => h.database.prepare('UPDATE accounts SET role=?2 WHERE id=?1').bind(id, role).run(), /replace_account_identity/);
    }
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM accounts').first('n'), 6);
});

test('credential changes during publication allow the admitted content and event writes', async () => {
    const check = beforeWrite(/INSERT INTO contents/, () => h.database.prepare("UPDATE accounts SET credential_version=credential_version+1 WHERE id='student-a'").run());
    const r = await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '已获准请求', body: '可以完成' });
    check(); assert.equal(r.status, 201);
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM contents WHERE kind='question'").first('n'), 1);
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM business_events WHERE type='question.created'").first('n'), 1);
});

test('logout during voting allows the admitted vote', async () => {
    const q = await h.postQuestion();
    const check = beforeWrite(/INSERT INTO votes/, () => h.database.prepare("DELETE FROM sessions WHERE account_id='student-b'").run());
    const r = await h.api('PUT', `/contents/${q}/vote`, 'student-b', { value: 1 });
    check(); assert.equal(r.status, 200);
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM votes').first('n'), 1);
});

test('disabling an account allows an edit that already passed entry authentication', async () => {
    const q = await h.postQuestion();
    const check = beforeWrite(/UPDATE contents SET title/, () => h.database.prepare("UPDATE accounts SET status='disabled' WHERE id='student-a'").run());
    const r = await h.api('PATCH', `/contents/${q}`, 'student-a', { revision: 1, body: '获准修改' });
    check(); assert.equal(r.status, 200);
    assert.equal(await h.database.prepare('SELECT revision FROM contents WHERE id=?').bind(q).first('revision'), 2);
});

test('term switches during course creation cannot grant an assignment or create an orphan course', async () => {
    const check = beforeWrite(/INSERT INTO courses/, () => setCurrentTerm(h.database, 'term-old'));
    const r = await h.api('POST', '/courses', 'teacher-a', { name: '切换学期', code: 'RACE01' });
    check(); assert.equal(r.status, 409);
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM courses WHERE code='RACE01'").first('n'), 0);
    assert.equal(await h.database.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE account_id='teacher-a'").first('n'), 1);
});

test('session expiry after admission allows acceptance and bonus ledger entries', async () => {
    await h.policy(); const q = await h.postQuestion(), a = await h.postAnswer(q);
    const check = beforeWrite(/UPDATE contents SET accepted_answer_id/, () => h.database.prepare("UPDATE sessions SET expires_at=1 WHERE account_id='teacher-a'").run());
    const r = await h.accept(q, a);
    check(); assert.equal(r.status, 200);
    assert.equal(await h.database.prepare('SELECT COUNT(*) AS n FROM bonus_ledger').first('n'), 1);
    assert.equal(await h.database.prepare('SELECT accepted_answer_id FROM contents WHERE id=?').bind(q).first('accepted_answer_id'), a);
});

test('retired data generations cannot finish moderation', async () => {
    const q = await h.postQuestion();
    const check = beforeWrite(/UPDATE contents SET status/, () => h.database.prepare("UPDATE accounts SET data_generation=data_generation+1 WHERE id='admin'").run());
    const r = await h.api('PUT', `/contents/${q}/moderation`, 'admin', { revision: 1, action: 'hide', reason: '已失去权限' });
    check(); assert.equal(r.status, 409);
    assert.equal(await h.database.prepare('SELECT status FROM contents WHERE id=?').bind(q).first('status'), 'visible');
});

test('concurrent course retries create one course, one assignment and one event', async () => {
    const body = { name: '并发课程', code: 'CONCURRENT01' }, opts = { key: 'concurrent-course-request' };
    const responses = await Promise.all([1, 2].map(() => h.api('POST', '/courses', 'teacher-a', body, opts)));
    for (const r of responses) assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(responses[0].data.id, responses[1].data.id);
    const id = responses[0].data.id;
    for (const table of ['courses', 'enrollments', 'business_events']) {
        assert.equal(await h.database.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'courses' ? 'id' : 'course_id'}=?`).bind(id).first('n'), 1);
    }
});

test('administrator can accept, adjust and cancel awards across courses', async () => {
    await h.policy(); const q = await h.postQuestion(), answer = await h.postAnswer(q);
    assert.equal((await h.accept(q, answer, 'admin')).status, 200);
    assert.equal((await h.api('PATCH', `/questions/${q}/award`, 'admin', { revision: await h.revision(q), bonusPoints: 3.25, reason: '管理员调整' })).status, 200);
    assert.equal(await h.database.prepare('SELECT SUM(delta_cents) AS n FROM bonus_ledger').first('n'), 325);
    assert.equal((await h.accept(q, null, 'admin')).status, 200);
    assert.equal(await h.database.prepare('SELECT SUM(delta_cents) AS n FROM bonus_ledger').first('n'), 0);
});

test('public times are integer seconds and paged totals use the same visibility filters', async () => {
    const q = await h.postQuestion(), hidden = await h.postQuestion();
    await h.api('PUT', `/contents/${hidden}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '隐藏筛选测试' });
    const detail = await h.api('GET', `/questions/${q}`);
    assert.equal(detail.data.author.nickname, '学习者甲'); assert.equal(detail.data.author.displayName, undefined);
    for (const time of [detail.data.createdAt, detail.data.updatedAt]) {
        assert.ok(Number.isInteger(time)); assert.ok(Math.abs(Date.now() / 1000 - time) < 60);
    }
    const pastEnd = await h.api('GET', '/courses/course-a/questions?page=2&pageSize=1');
    assert.equal(pastEnd.data.total, 1); assert.deepEqual(pastEnd.data.items, []);
    const noMatches = await h.api('GET', '/courses/course-a/questions?tag=missing');
    assert.equal(noMatches.data.total, 0);
    const bad = await h.api('GET', '/courses?page=0');
    assert.deepEqual(Object.keys(bad.data.error).sort(), ['code', 'message']);
    assert.ok(bad.headers.get('x-request-id')); assert.equal(bad.headers.get('cache-control'), 'no-store');
});

const businessTables = ['courses', 'terms', 'enrollments',
    'file_versions', 'contents', 'votes', 'bonus_ledger', 'reports', 'moderation_actions', 'business_events'];
const businessSnapshot = () => Promise.all(businessTables.map(async table =>
    (await h.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));

for (const mode of ['switch', 'delete']) {
    test(`${mode} retires identities without losing any business rows or other users' replies`, async () => {
        await h.policy();
        const teacherQuestion = await h.postQuestion('teacher-a');
        const question = await h.postQuestion('student-a', { body: '[讲义](/materials/material-a/versions/version-a1)' });
        const answer = await h.postAnswer(teacherQuestion, 'student-a');
        const otherAnswer = await h.postAnswer(question);
        assert.equal((await h.accept(teacherQuestion, answer)).status, 200);
        assert.equal((await h.api('PUT', `/contents/${otherAnswer}/vote`, 'student-a', { value: 1 })).status, 200);
        assert.equal((await h.api('POST', `/contents/${otherAnswer}/reports`, 'student-a', { reason: '待审查记录' })).status, 201);
        const hidden = await h.postQuestion('student-b');
        assert.equal((await h.api('PUT', `/contents/${hidden}/moderation`, 'teacher-a', { revision: 1, action: 'hide', reason: '保留审查记录' })).status, 200);
        assert.equal((await h.api('POST', '/courses', 'teacher-a', { name: '保留创建的课程', code: 'RETAINED' })).status, 201);
        assert.equal((await h.api('PATCH', '/admin/accounts/student-a', 'admin', { department: '院系', major: '专业', grade: '2024级' })).status, 200);
        await h.env.FILES.put('materials/retained-file', 'fictional material bytes');
        const before = await businessSnapshot();
        const auditBefore = (await h.database.prepare('SELECT * FROM account_audit ORDER BY id').all()).results;
        const replacements = [];
        for (const [oldId, role] of [['teacher-a', 'student'], ['student-a', 'teacher']]) {
            const old = await h.database.prepare('SELECT * FROM accounts WHERE id=?').bind(oldId).first();
            const response = await h.api(mode === 'switch' ? 'PATCH' : 'DELETE', `/admin/accounts/${oldId}`, 'admin',
                mode === 'switch' ? { role } : undefined);
            assert.equal(response.status, 200, JSON.stringify(response.data));
            if (mode === 'switch') {
                const next = await h.database.prepare('SELECT * FROM accounts WHERE id=?').bind(response.data.id).first();
                assert.notEqual(next.id, oldId); assert.equal(next.role, role);
                for (const field of ['nickname', 'school_number', 'password', 'name', 'department', 'major', 'grade', 'avatar_key', 'created_at', 'last_login_at']) {
                    assert.equal(next[field], old[field], field);
                }
                replacements.push(next);
            }
            const retired = await h.database.prepare('SELECT * FROM accounts WHERE id=?').bind(oldId).first();
            assert.equal(retired.status, 'deleted'); assert.equal(retired.nickname, '已删除'); assert.equal(retired.data_generation, 2);
            for (const field of ['school_number', 'password', 'name', 'department', 'major', 'grade', 'avatar_key', 'last_login_at']) assert.equal(retired[field], null, field);
            assert.equal((await h.api('GET', '/auth/me', oldId)).status, 401);
            assert.equal((await h.api('GET', `/admin/accounts/${oldId}/audit`, 'admin')).status, 200);
        }
        assert.deepEqual(await businessSnapshot(), before);
        for (const row of auditBefore) assert.deepEqual(await h.database.prepare('SELECT * FROM account_audit WHERE id=?').bind(row.id).first(), row);
        assert.equal(await (await h.env.FILES.get('materials/retained-file')).text(), 'fictional material bytes');
        for (const id of [teacherQuestion, question, answer]) {
            const detail = await h.api('GET', `/contents/${id}`);
            assert.equal(detail.status, 200); assert.equal(detail.data.author.nickname, '已删除');
            assert.equal(detail.data.author.isDeleted, true); assert.equal(detail.data.author.isTeacher, false);
        }
        assert.equal((await h.api('GET', `/contents/${otherAnswer}`)).data.author.nickname, '学习者乙');
        assert.equal((await h.api('GET', `/questions/${teacherQuestion}`)).data.acceptedAnswerId, answer);
        assert.equal((await h.api('GET', '/courses/course-a/bonus-summary', 'admin')).data.items[0].nickname, '已删除');
        const list = await h.api('GET', '/admin/accounts', 'admin');
        assert.ok(list.data.items.every(a => !['teacher-a', 'student-a'].includes(a.id)));
        if (mode === 'switch') {
            const next = replacements[1], token = 'e'.repeat(64);
            await h.database.prepare('INSERT INTO sessions VALUES (?,?,?,unixepoch()+3600)').bind(await digest(token), next.id, next.credential_version).run();
            const options = { headers: { Cookie: `coursestack_session=${token}` } };
            assert.equal((await h.api('GET', '/me/activity', undefined, undefined, options)).data.total, 0);
            assert.equal((await h.api('GET', '/me/bonus-ledger', undefined, undefined, options)).data.total, 0);
            assert.equal((await h.api('PATCH', `/contents/${question}`, undefined, { revision: 1, body: '不能继承所有权' }, options)).status, 403);
            assert.equal((await h.api('GET', '/courses/course-a/bonus-ledger', undefined, undefined, options)).status, 403);
        }
        assert.deepEqual((await h.database.prepare('PRAGMA foreign_key_check').all()).results, []);
    });

    test(`${mode} rejects an old admitted publication after retirement`, async () => {
        const check = beforeWrite(/INSERT INTO contents/, async () => {
            const response = await h.api(mode === 'switch' ? 'PATCH' : 'DELETE', '/admin/accounts/student-a', 'admin',
                mode === 'switch' ? { role: 'teacher' } : undefined);
            assert.equal(response.status, 200);
        });
        const result = await h.api('POST', '/courses/course-a/questions', 'student-a', { title: '跨身份请求', body: '不能写回旧身份' });
        check(); assert.equal(result.status, 409);
        assert.equal(await h.database.prepare("SELECT count(*) AS n FROM contents WHERE kind='question'").first('n'), 0);
        assert.equal(await h.database.prepare("SELECT count(*) AS n FROM business_events WHERE type='question.created'").first('n'), 0);
    });
}