import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { doc, start } from './discussions-helpers.mjs';

let h;
beforeEach(async () => { h = await start(); });
afterEach(async () => { await h?.dispose(); });

async function get(path, as) {
    const response = await h.api('GET', path, as);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
}
async function comment(targetKind, targetId, as = 'teacher-a', text = '教师评论') {
    const response = await h.api('POST', '/comments', as, { targetKind, targetId, body: doc(text) });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id;
}
async function moderate(id, action) {
    const response = await h.api('PUT', `/contents/${id}/moderation`, 'admin', { action, reason: '教师主页可见性测试' });
    assert.equal(response.status, 200, JSON.stringify(response.data));
}
const activity = (kind, as) => get(`/teachers/teacher-a/activity?kind=${kind}`, as);
const counts = as => get('/teachers/teacher-a/counts', as);

test('anonymous teacher profiles whitelist public identity and empty counts remain numeric', async () => {
    await h.database.prepare("UPDATE accounts SET nickname=NULL,name='private-name',department='private-department',avatar_key='private-key' WHERE id='teacher-a'").run();
    assert.deepEqual(await get('/teachers/teacher-a'), { id: 'teacher-a', nickname: null, avatarUrl: '/api/profiles/teacher-a/avatar', isTeacher: true, isDeleted: false });
    assert.deepEqual(await counts(), { courses: 1, materials: 0, questions: 0, answers: 0, comments: 0 });
    await h.database.prepare("INSERT INTO accounts(id,role,school_number) VALUES ('teacher-empty','teacher','empty-private-number')").run();
    const empty = await get('/teachers/teacher-empty/counts');
    assert.deepEqual(empty, { courses: 0, materials: 0, questions: 0, answers: 0, comments: 0 });
    for (const kind of ['course', 'material', 'question', 'answer', 'comment']) {
        assert.deepEqual(await get(`/teachers/teacher-empty/activity?kind=${kind}`), { kind, items: [], total: 0, page: 1, pageSize: 20 });
    }
    const encoded = JSON.stringify(await get('/teachers/teacher-a/activity'));
    for (const secret of ['private-name', 'private-department', 'private-key', 'schoolNumber', 'studentId', 'bonusPolicy']) assert.ok(!encoded.includes(secret), secret);
});

test('teaching courses are deduplicated across semesters and independently paginated', async () => {
    assert.equal((await get('/teachers/teacher-b/counts')).courses, 2);
    assert.equal((await h.api('PUT', '/courses/course-a/terms/term-active/teachers/me', 'teacher-b')).status, 200);
    const first = await get('/teachers/teacher-b/activity?kind=course&pageSize=1');
    const second = await get('/teachers/teacher-b/activity?kind=course&pageSize=1&page=2');
    assert.equal(first.total, 2); assert.equal(second.total, 2);
    assert.equal(first.items[0].id, 'course-a'); assert.equal(second.items[0].id, 'course-b');
    assert.deepEqual(first.items[0].terms, [
        { id: 'term-active', name: '当前学期', current: true }, { id: 'term-old', name: '历史学期', current: false }
    ]);
    assert.deepEqual((await get('/teachers/teacher-b/activity?kind=course&pageSize=1&page=3')).items, []);
    const materials = await get('/teachers/teacher-b/activity?kind=material');
    assert.equal(materials.total, 1); assert.equal(materials.items[0].id, 'material-b');
    assert.equal(materials.items[0].latestVersion.version, 1);
    assert.equal(materials.items[0].courseName, '大学物理');
    assert.equal(materials.items[0].quote, null);
    assert.deepEqual(materials.items[0].root, { id: 'material-b', kind: 'material', title: '物理讲义' });
    assert.ok(!JSON.stringify(materials).includes('storage_key'));
    const all = await get('/teachers/teacher-b/counts');
    assert.equal(all.courses, 2); assert.equal(all.materials, materials.total);
});

test('answer and comment pages include root titles, one direct quote, and visible acceptance', async () => {
    const q = await h.postQuestion('student-a', { title: '原问题标题' });
    const answer = await h.postAnswer(q, 'teacher-a', doc('教师解答'));
    assert.equal((await h.accept(q, answer)).status, 200);
    await h.postQuestion('teacher-a');
    const otherAnswer = await h.postAnswer(q, 'student-b', doc('被评论的回答'));
    const onQuestion = await comment('question', q);
    const onMaterial = await comment('material', 'material-b');
    const onAnswer = await comment('answer', otherAnswer);
    const original = await comment('answer', otherAnswer, 'student-a', '待引用的评论');
    const reply = await comment('comment', original, 'teacher-a', '教师的直接回复');
    const replyAgain = await comment('comment', reply, 'teacher-a', '下一条回复');
    const answers = await activity('answer');
    assert.equal(answers.items[0].isAccepted, true);
    assert.deepEqual(answers.items[0].root, { id: q, kind: 'question', title: '原问题标题' });
    assert.equal(answers.items[0].quote, null);
    const comments = await activity('comment'), byId = new Map(comments.items.map(item => [item.id, item]));
    assert.equal(byId.get(onQuestion).quote, null);
    assert.equal(byId.get(onMaterial).root.kind, 'material'); assert.equal(byId.get(onMaterial).quote, null);
    assert.equal(byId.get(onAnswer).quote.kind, 'answer'); assert.equal(byId.get(onAnswer).quote.excerpt, '被评论的回答');
    assert.deepEqual(byId.get(reply).root, { id: q, kind: 'question', title: '原问题标题' });
    assert.deepEqual(byId.get(reply).quote, { kind: 'comment', available: true, author: { nickname: '学习者甲', isDeleted: false }, excerpt: '待引用的评论' });
    assert.equal(byId.get(replyAgain).quote.excerpt, '教师的直接回复');
    assert.ok(!JSON.stringify(byId.get(replyAgain)).includes('待引用的评论'));
    const totals = await counts();
    assert.deepEqual(totals, { courses: 1, materials: 0, questions: 1, answers: 1, comments: 5 });
    for (const [kind, key] of [['material', 'materials'], ['question', 'questions'], ['answer', 'answers'], ['comment', 'comments']]) {
        assert.equal((await activity(kind)).total, totals[key]);
    }
    await h.database.prepare("UPDATE accounts SET status='deleted' WHERE id='student-a'").run();
    assert.deepEqual((await activity('comment')).items.find(item => item.id === reply).quote.author, { nickname: '已删除', isDeleted: true });
});

test('hidden and deleted quotes never expose text, including to their owner and managers', async () => {
    const q = await h.postQuestion(), original = await comment('question', q, 'teacher-a', 'secret-quote-text');
    const reply = await comment('comment', original, 'teacher-a', '公开的独立回复');
    for (const action of ['hide', 'delete']) {
        await moderate(original, action);
        for (const as of [undefined, 'teacher-a', 'admin']) {
            const list = await activity('comment', as);
            assert.equal(list.total, 1); assert.equal((await counts(as)).comments, 1);
            assert.equal(list.items[0].id, reply);
            assert.deepEqual(list.items[0].quote, { kind: 'comment', available: false, author: null, excerpt: null });
            assert.ok(!JSON.stringify(list).includes('secret-quote-text'));
        }
    }
});

test('hiding an ancestor removes the whole branch from public counts and all viewer variants', async () => {
    const q = await h.postQuestion('teacher-a', { title: 'private-after-hide' });
    const a = await h.postAnswer(q, 'teacher-a');
    await comment('answer', a); await comment('question', q);
    await moderate(q, 'hide');
    for (const as of [undefined, 'teacher-a', 'admin']) {
        assert.deepEqual(await counts(as), { courses: 1, materials: 0, questions: 0, answers: 0, comments: 0 });
        for (const kind of ['question', 'answer', 'comment']) {
            const list = await activity(kind, as); assert.equal(list.total, 0); assert.deepEqual(list.items, []);
        }
    }
    await moderate(q, 'restore');
    assert.deepEqual(await counts(), { courses: 1, materials: 0, questions: 1, answers: 1, comments: 2 });
    await moderate(a, 'hide');
    assert.deepEqual(await counts(), { courses: 1, materials: 0, questions: 1, answers: 0, comments: 1 });
    await moderate(q, 'delete');
    assert.deepEqual(await counts(), { courses: 1, materials: 0, questions: 0, answers: 0, comments: 0 });
});

test('publication ordering, stable ties and pagination limits apply to content pages', async () => {
    const ids = [];
    for (let index = 0; index < 23; index++) ids.push(await h.postQuestion('teacher-a', { title: `公开问题 ${index}` }));
    await h.database.prepare("UPDATE contents SET created_at=100 WHERE author_id='teacher-a'").run();
    await h.database.prepare('UPDATE contents SET created_at=200 WHERE id=?').bind(ids[0]).run();
    await h.database.prepare('UPDATE contents SET updated_at=300 WHERE id=?').bind(ids[1]).run();
    const first = await activity('question'), second = await get('/teachers/teacher-a/activity?kind=question&page=2');
    assert.equal(first.items.length, 20); assert.equal(second.items.length, 3); assert.equal(first.total, 23);
    assert.deepEqual([...first.items, ...second.items].map(item => item.id), [ids[0], ...ids.slice(1).sort()]);
    assert.equal((await counts()).questions, 23);
    for (const query of ['page=0', 'page=10001', 'page=1.5', 'pageSize=0', 'pageSize=51', 'kind=all', 'kind=student', 'kind=']) {
        assert.equal((await h.api('GET', `/teachers/teacher-a/activity?${query}`)).status, 400, query);
    }
    const emptyPage = await get('/teachers/teacher-a/activity?kind=question&page=10000');
    assert.equal(emptyPage.total, 23); assert.deepEqual(emptyPage.items, []);
});

test('missing, non-teacher, disabled and deleted accounts cannot expose a teacher homepage', async () => {
    const unavailable = async id => {
        for (const suffix of ['', '/counts', '/activity?kind=course', '/activity?kind=material']) {
            const response = await h.api('GET', `/teachers/${id}${suffix}`, 'admin');
            assert.equal(response.status, 404); assert.equal(response.data.error.code, 'TEACHER_NOT_FOUND');
        }
    };
    for (const id of ['missing', 'student-a', 'admin']) await unavailable(id);
    await h.database.prepare("UPDATE accounts SET status='disabled' WHERE id='teacher-b'").run(); await unavailable('teacher-b');
    await h.database.prepare("UPDATE accounts SET status='deleted' WHERE id='teacher-b'").run(); await unavailable('teacher-b');
});