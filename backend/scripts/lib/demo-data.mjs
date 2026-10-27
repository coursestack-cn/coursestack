import { createHash } from 'node:crypto';
import { hashPassword } from '../../src/auth/crypto.ts';
import { HttpError } from '../../src/http.ts';

const stableId = (name) => createHash('sha256').update(`coursestack-opening-demo-v1:${name}`).digest('hex').slice(0, 32);
const courseName = '数据库系统原理';
const courseId = stableId('course');
const members = [
    { number: 'T0001', role: 'teacher', name: '演示教师' },
    ...Array.from({ length: 100 }, (_, i) => ({ number: `S${String(i + 1).padStart(4, '0')}`, role: 'student', name: `演示同学 ${String(i + 1).padStart(3, '0')}` })),
].map((member) => ({ ...member, id: stableId(member.number) }));
const teacher = members[0];
const conflict = (message) => new HttpError(409, 'DEMO_CONFLICT', message);

// Re-running only fills missing demo accounts and course relationships. Existing
// passwords, profiles, account status and forced-password flags are preserved.
export async function prepareDemoData(binding, { dryRun = false, course: requestedCourse } = {}) {
    const numbers = JSON.stringify(members.map((m) => m.number));
    const ids = JSON.stringify(members.map((m) => m.id));
    const [accountResult, termResult, courseResult] = await binding.batch([
        binding.prepare(`SELECT a.id, a.school_number AS number, a.must_change_password, a.role
            FROM accounts a WHERE a.id IN (SELECT value FROM json_each(?)) OR a.school_number IN (SELECT value FROM json_each(?))`).bind(ids, numbers),
        binding.prepare(`SELECT id, name FROM terms WHERE current = 1`),
        requestedCourse
            ? binding.prepare('SELECT id, name FROM courses WHERE id = ?').bind(requestedCourse)
            : binding.prepare('SELECT id, name FROM courses WHERE name = ? OR id = ?').bind(courseName, courseId),
    ]);
    const expected = new Map(members.map((m) => [m.id, m]));
    for (const row of accountResult.results) {
        const member = expected.get(row.id);
        if (!member || row.number !== member.number || row.role !== member.role) {
            throw conflict('演示学工号或账号 ID 已被其他数据使用，或演示账号身份已变化；未覆盖任何账号。');
        }
    }
    const currentTerm = termResult.results[0];
    if (!currentTerm) throw conflict('请先设置当前学期，再创建演示课程实例。');
    if (courseResult.results.length > 1) throw conflict('存在多个同名课程，请用 --course-id 指定演示课程。');
    if (requestedCourse && !courseResult.results.length) throw conflict('指定的课程不存在。');
    const selectedCourse = courseResult.results[0] ?? { id: courseId, name: courseName };
    const assigned = await binding.prepare(`SELECT e.account_id FROM enrollments e JOIN accounts a ON a.id=e.account_id
        WHERE e.course_id=? AND e.term_id=? AND a.role='teacher'`).bind(selectedCourse.id, currentTerm.id).first();
    if (assigned && assigned.account_id !== teacher.id) throw conflict('该课程当前学期已有其他教师，不能再加入演示教师；请另选课程。');
    const existingIds = new Set(accountResult.results.map((m) => m.id));
    const missing = members.filter((m) => !existingIds.has(m.id));
    const selectedTerm = currentTerm.id;
    const summary = {
        dryRun, createdAccounts: missing.length, existingAccounts: existingIds.size,
        studentAccounts: 'S0001–S0100', teacherAccount: teacher.number,
        courseId: selectedCourse.id, courseName: selectedCourse.name,
        termId: selectedTerm, termName: currentTerm.name,
        createsCourse: !courseResult.results.length, createsCurrentTerm: false,
    };
    if (dryRun) return summary;
    const fresh = [];
    for (const member of missing) fresh.push({ ...member, hash: await hashPassword(member.number) });
    const payload = JSON.stringify(fresh);
    // Every write checks the current-term snapshot; a concurrent switch makes the batch a no-op.
    const guard = '(SELECT id FROM terms WHERE current = 1) IS ?';
    const insertMembers = (sql) => binding.prepare(`${sql} WHERE ${guard}`).bind(payload, currentTerm.id);
    const statements = [
        binding.prepare('PRAGMA defer_foreign_keys=ON'),
        binding.prepare(`SELECT ${guard} AS ready`).bind(currentTerm.id),
        insertMembers(`INSERT INTO accounts (id, nickname, role, school_number, password, name, must_change_password)
            SELECT value ->> '$.id', value ->> '$.name', value ->> '$.role', value ->> '$.number',
                value ->> '$.hash', value ->> '$.name', 0 FROM json_each(?)`),
        binding.prepare(`INSERT INTO enrollments (course_id, term_id, account_id) SELECT ?, ?, ? WHERE ${guard}
            ON CONFLICT(course_id, term_id, account_id) DO NOTHING`).bind(selectedCourse.id, selectedTerm, teacher.id, currentTerm.id),
        ...(!courseResult.results.length ? [binding.prepare(`INSERT INTO courses (id, name, code, created_by, updated_by, request_key, request_hash)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`).bind(selectedCourse.id, selectedCourse.name, 'DEMO-DATABASE', teacher.id, teacher.id, 'demo-course', stableId('course-request'), currentTerm.id)] : []),
        binding.prepare(`INSERT INTO enrollments (course_id, term_id, account_id)
            SELECT ?, ?, value FROM json_each(?) WHERE ${guard}
            ON CONFLICT(course_id, term_id, account_id) DO NOTHING`)
            .bind(selectedCourse.id, selectedTerm, JSON.stringify(members.filter((m) => m.role === 'student').map((m) => m.id)), currentTerm.id),
    ];
    const result = await binding.batch(statements);
    if (!Number(result[1].results[0]?.ready)) throw conflict('当前学期已变化，本次未写入数据，请重新预览。');
    return summary;
}