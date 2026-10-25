-- Fictional fixtures only. These accounts have no credentials and cannot log in.
INSERT INTO accounts (id, public_name) VALUES
    ('demo-teacher', '演示教师'),
    ('demo-student', '演示同学'), ('demo-history', '历年演示同学')
ON CONFLICT(id) DO NOTHING;

INSERT INTO account_roles (account_id, role) VALUES
    ('demo-teacher', 'teacher'),
    ('demo-student', 'student'), ('demo-history', 'student')
ON CONFLICT(account_id, role) DO NOTHING;

INSERT INTO student_records (account_id, student_number, real_name) VALUES
    ('demo-student', 'DEMO-001', '虚构学生甲'), ('demo-history', 'DEMO-002', '虚构学生乙')
ON CONFLICT(account_id) DO NOTHING;

INSERT INTO account_private (account_id, real_name)
SELECT a.id, s.real_name FROM accounts a LEFT JOIN student_records s ON s.account_id = a.id
WHERE a.id IN ('demo-teacher', 'demo-student', 'demo-history')
ON CONFLICT(account_id) DO NOTHING;

INSERT INTO courses (id, name) VALUES ('demo-course', '演示课程') ON CONFLICT(id) DO NOTHING;
INSERT INTO terms (id, name) VALUES ('demo-current', '演示当前学期'), ('demo-previous', '演示历年学期')
ON CONFLICT(id) DO NOTHING;
UPDATE academic_settings SET current_term_id = 'demo-current' WHERE id = 1 AND current_term_id IS NULL;

INSERT INTO teaching_assignments (course_id, term_id, teacher_id) VALUES
    ('demo-course', 'demo-current', 'demo-teacher'), ('demo-course', 'demo-previous', 'demo-teacher')
ON CONFLICT(course_id, term_id, teacher_id) DO NOTHING;
INSERT INTO enrollments (course_id, term_id, student_id) VALUES
    ('demo-course', 'demo-current', 'demo-student'), ('demo-course', 'demo-previous', 'demo-history')
ON CONFLICT(course_id, term_id, student_id) DO NOTHING;