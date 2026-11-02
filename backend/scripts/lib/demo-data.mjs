import { createHash } from 'node:crypto';
import { hashPassword } from '../../src/auth/crypto.ts';
import { HttpError } from '../../src/http.ts';

const stableId = (name) => createHash('sha256').update(`coursestack-opening-demo-v1:${name}`).digest('hex').slice(0, 32);
const courseName = '数据库系统原理';
const courseId = '304208040';
const academic = { department: '计算机学院', major: '计算机科学与技术' };
const members = [
    { number: 'T0001', role: 'teacher', name: '演示教师', ...academic, grade: null },
    ...Array.from({ length: 100 }, (_, i) => ({ number: `S${String(i + 1).padStart(4, '0')}`, role: 'student', name: `演示同学 ${String(i + 1).padStart(3, '0')}`, ...academic, grade: '2024 级' })),
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
    if (courseResult.results.length > 1) throw conflict('存在多个同名课程，无法准备演示数据。');
    if (requestedCourse && !courseResult.results.length) throw conflict('指定的课程不存在。');
    const selectedCourse = courseResult.results[0] ?? { id: courseId, name: courseName };
    const assigned = await binding.prepare(`SELECT 1 FROM class_students WHERE course_id=? AND term_id=?
        AND student_id IN (SELECT value FROM json_each(?)) AND teacher_id<>?`).bind(selectedCourse.id, currentTerm.id, ids, teacher.id).first();
    if (assigned) throw conflict('演示学生已属于该课程其他教师的教学班；未覆盖学生归属。');
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
        insertMembers(`INSERT INTO accounts (id, nickname, role, school_number, password, name, department, major, grade, must_change_password)
            SELECT value ->> '$.id', value ->> '$.name', value ->> '$.role', value ->> '$.number',
                value ->> '$.hash', value ->> '$.name', value ->> '$.department', value ->> '$.major', value ->> '$.grade', 0 FROM json_each(?)`),
        binding.prepare(`INSERT INTO accounts(id,nickname,role) SELECT ?, '管理员', 'admin' WHERE ${guard}
            AND NOT EXISTS(SELECT 1 FROM accounts WHERE role='admin')`).bind(stableId('administrator'), currentTerm.id),
        ...(!courseResult.results.length ? [binding.prepare(`INSERT INTO courses (id, name, created_by, request_key, request_hash)
            SELECT ?, ?, id, ?, ? FROM accounts WHERE role='admin' AND ${guard}`)
            .bind(selectedCourse.id, selectedCourse.name, 'demo-course', stableId('course-request'), currentTerm.id)] : []),
        binding.prepare(`INSERT INTO course_terms(course_id,term_id) SELECT ?, ? WHERE ${guard} ON CONFLICT DO NOTHING`)
            .bind(selectedCourse.id, selectedTerm, currentTerm.id),
        binding.prepare(`INSERT INTO teaching_classes(course_id,term_id,teacher_id) SELECT ?, ?, ? WHERE ${guard} ON CONFLICT DO NOTHING`)
            .bind(selectedCourse.id, selectedTerm, teacher.id, currentTerm.id),
        binding.prepare(`INSERT INTO class_students(course_id,term_id,teacher_id,student_id)
            SELECT ?, ?, ?, value FROM json_each(?) WHERE ${guard}
            ON CONFLICT(course_id,term_id,student_id) DO UPDATE SET teacher_id=excluded.teacher_id
            WHERE class_students.teacher_id<>excluded.teacher_id`)
            .bind(selectedCourse.id, selectedTerm, teacher.id, JSON.stringify(members.filter((m) => m.role === 'student').map((m) => m.id)), currentTerm.id),
    ];
    let result;
    try { result = await binding.batch(statements); }
    catch { throw conflict('未能确认演示数据写入结果；请核对账号、开课安排及学生归属后重试。'); }
    if (!Number(result[1].results[0]?.ready)) throw conflict('当前学期已变化，本次未写入数据。');
    return summary;
}