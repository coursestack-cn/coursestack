import { createHash } from 'node:crypto';
import { hashPassword } from '../../src/auth/crypto.ts';
import { HttpError } from '../../src/http.ts';

const stableId = (name) => createHash('sha256').update(`coursestack-opening-demo-v1:${name}`).digest('hex').slice(0, 32);
const academic = { department: '计算机学院', major: '计算机科学与技术' };
const conflict = (message) => new HttpError(409, 'DEMO_CONFLICT', message);
const previousTermId = '25-2';

function demoMembers(role, count) {
    const isTeacher = role === 'teacher';
    return Array.from({ length: count }, (_, i) => {
        const serial = String(i + 1);
        const number = (isTeacher ? 'T' : 'S') + serial.padStart(4, '0');
        const name = `${isTeacher ? '演示教师' : '演示同学'} ${serial.padStart(3, '0')}`;
        return { id: stableId(number), number, name, role, ...academic, grade: isTeacher ? null : '2024 级' };
    });
}
const teachers = demoMembers('teacher', 5);
const students = demoMembers('student', 100);
const members = [...teachers, ...students];

function roster(teacherNumber, firstStudent, lastStudent) {
    return { teacherId: stableId(teacherNumber), studentIds: students.slice(firstStudent - 1, lastStudent).map(s => s.id) };
}
const databaseCourse = {
    id: '304208040', name: '数据库系统原理',
    introduction: '学习关系模型、SQL 查询和数据库设计，通过建表、索引与事务实验，理解数据库如何执行查询并在并发访问时保持数据一致。',
    current: [roster('T0001', 1, 50)],
};
const catalog = [
    databaseCourse,
    {
        id: '304064030', name: '现代软件工程（双语）',
        current: [roster('T0001', 26, 50), roster('T0002', 51, 75)],
    },
    {
        id: '101103020', name: '大学美育·音乐鉴赏',
        current: [roster('T0003', 76, 84), roster('T0004', 85, 92), roster('T0005', 93, 100)],
        previous: [roster('T0003', 51, 75), roster('T0004', 76, 100)],
    },
];

function offeringStatements(binding, { courseId, termId, classes }) {
    const statements = [binding.prepare('INSERT INTO course_terms(course_id,term_id) VALUES (?,?) ON CONFLICT DO NOTHING')
        .bind(courseId, termId)];
    for (const { teacherId, studentIds } of classes) {
        statements.push(
            binding.prepare('INSERT INTO teaching_classes(course_id,term_id,teacher_id) VALUES (?,?,?) ON CONFLICT DO NOTHING')
                .bind(courseId, termId, teacherId),
            binding.prepare(`INSERT INTO class_students(course_id,term_id,teacher_id,student_id)
                SELECT ?,?,?,value FROM json_each(?) WHERE true
                ON CONFLICT(course_id,term_id,student_id) DO UPDATE SET teacher_id=excluded.teacher_id
                WHERE class_students.teacher_id<>excluded.teacher_id`).bind(courseId, termId, teacherId, JSON.stringify(studentIds)),
        );
    }
    return statements;
}

export async function prepareDemoData(binding, { dryRun = false, course: requestedCourse } = {}) {
    const numbers = JSON.stringify(members.map((m) => m.number));
    const ids = JSON.stringify(members.map((m) => m.id));
    const [accountResult, termResult, ...courseResults] = await binding.batch([
        binding.prepare(`SELECT a.id, a.school_number AS number, a.role
            FROM accounts a WHERE a.id IN (SELECT value FROM json_each(?)) OR a.school_number IN (SELECT value FROM json_each(?))`).bind(ids, numbers),
        binding.prepare('SELECT id, name FROM terms WHERE current = 1'),
        ...catalog.map(course => course === databaseCourse && requestedCourse
            ? binding.prepare('SELECT id, name FROM courses WHERE id = ?').bind(requestedCourse)
            : binding.prepare('SELECT id, name FROM courses WHERE name = ? OR id = ?').bind(course.name, course.id)),
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
    if (currentTerm.id === previousTermId) throw conflict('历年学期与当前学期必须不同。');
    const courses = catalog.map((course, i) => {
        const rows = courseResults[i].results;
        const existing = rows[0];
        if (rows.length > 1) throw conflict(`课程“${course.name}”的名称或编号不唯一。`);
        if (course === databaseCourse && requestedCourse && !existing) throw conflict('指定的课程不存在。');
        if (course !== databaseCourse && existing && (existing.id !== course.id || existing.name !== course.name)) {
            throw conflict(`课程“${course.name}”的名称或编号已被占用。`);
        }
        return { ...course, ...existing, exists: Boolean(existing) };
    });
    const selectedCourse = courses[0];
    if (new Set(courses.map(course => course.id)).size !== courses.length) throw conflict('不同演示课程不能共用同一课程号。');
    const current = courses.map(course => ({ courseId: course.id, termId: currentTerm.id, classes: course.current }));
    const previous = courses.filter(course => course.previous)
        .map(course => ({ courseId: course.id, termId: previousTermId, classes: course.previous }));
    const assignments = await binding.batch([...current, ...previous].flatMap(({ courseId, termId, classes }) =>
        classes.map(({ teacherId, studentIds }) => binding.prepare(`SELECT 1 FROM class_students WHERE course_id=? AND term_id=?
            AND teacher_id<>? AND student_id IN (SELECT value FROM json_each(?)) LIMIT 1`)
            .bind(courseId, termId, teacherId, JSON.stringify(studentIds)))));
    if (assignments.some(result => result.results.length)) throw conflict('演示学生已属于该课程其他教师的教学班；未覆盖学生归属。');
    const existingIds = new Set(accountResult.results.map((m) => m.id));
    const missing = members.filter((m) => !existingIds.has(m.id));
    const summary = {
        dryRun, createdAccounts: missing.length, existingAccounts: existingIds.size,
        studentAccounts: 'S0001–S0100', teacherAccount: teachers[0].number, teacherAccounts: 'T0001–T0005',
        courseId: selectedCourse.id, courseName: selectedCourse.name,
        courses: courses.map(({ id, name }) => ({ id, name })),
        termId: currentTerm.id, termName: currentTerm.name,
        createsCourse: !selectedCourse.exists, createsCurrentTerm: false,
    };
    if (dryRun) return summary;
    const fresh = [];
    for (const member of missing) fresh.push({ ...member, hash: await hashPassword(member.number) });
    const statements = [
        binding.prepare(`INSERT INTO accounts (id, nickname, role, school_number, password, name, department, major, grade, must_change_password)
            SELECT value ->> '$.id', value ->> '$.name', value ->> '$.role', value ->> '$.number',
                value ->> '$.hash', value ->> '$.name', value ->> '$.department', value ->> '$.major', value ->> '$.grade', 0 FROM json_each(?)`)
            .bind(JSON.stringify(fresh)),
        binding.prepare(`INSERT INTO accounts(id,nickname,role) SELECT ?, '管理员', 'admin'
            WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE role='admin')`).bind(stableId('administrator')),
        ...courses.filter(course => !course.exists).map(course => binding.prepare(`INSERT INTO courses
            (id,name,introduction,created_by,request_key,request_hash) SELECT ?,?,?,id,?,? FROM accounts WHERE role='admin'`)
            .bind(course.id, course.name, course.introduction ?? '', `demo-course-${course.id}`, stableId(`course-request:${course.id}`))),
        // Each class insert checks the current term in the database, including on a rerun.
        // A term change since preparation therefore rolls back the entire batch.
        ...current.flatMap(offering => offeringStatements(binding, offering)),
        // The historical classes must be enrolled while their term is current. Only the final term is visible outside this batch.
        binding.prepare('INSERT INTO terms(id,name) VALUES (?,?) ON CONFLICT(id) DO NOTHING').bind(previousTermId, '2026春'),
        binding.prepare('UPDATE terms SET current=0 WHERE id=?').bind(currentTerm.id),
        binding.prepare('UPDATE terms SET current=1 WHERE id=?').bind(previousTermId),
        ...previous.flatMap(offering => offeringStatements(binding, offering)),
        binding.prepare('UPDATE terms SET current=0 WHERE id=?').bind(previousTermId),
        binding.prepare('UPDATE terms SET current=1 WHERE id=?').bind(currentTerm.id),
    ];
    try { await binding.batch(statements); }
    catch { throw conflict('未能确认演示数据写入结果，请核对账号、当前学期及教学班归属后重试。'); }
    return summary;
}