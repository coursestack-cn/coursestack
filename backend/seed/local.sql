PRAGMA defer_foreign_keys=ON;

-- Fictional fixtures only. These accounts have no passwords and cannot log in.
INSERT INTO accounts (id, nickname, role, school_number, name) VALUES
    ('demo-teacher', '演示教师', 'teacher', NULL, NULL),
    ('demo-student', '演示同学', 'student', 'DEMO-001', '虚构学生甲'),
    ('demo-history', '历年演示同学', 'student', 'DEMO-002', '虚构学生乙')
ON CONFLICT(id) DO NOTHING;

INSERT INTO terms (id, name) VALUES ('demo-current', '演示当前学期'), ('demo-previous', '演示历年学期')
ON CONFLICT(id) DO NOTHING;
UPDATE terms SET current = 1 WHERE id = 'demo-current' AND NOT EXISTS (SELECT 1 FROM terms WHERE current=1);

INSERT INTO enrollments (course_id, term_id, account_id)
SELECT 'demo-course', id, 'demo-teacher' FROM terms WHERE current=1
ON CONFLICT(course_id, term_id, account_id) DO NOTHING;
INSERT INTO courses (id, name) VALUES ('demo-course', '演示课程') ON CONFLICT(id) DO NOTHING;
INSERT INTO enrollments (course_id, term_id, account_id)
SELECT 'demo-course', id, 'demo-student' FROM terms WHERE current=1
ON CONFLICT(course_id, term_id, account_id) DO NOTHING;

-- Metadata only. The discussion examples do not create R2 objects or download links.
INSERT INTO contents (id, kind, course_id, author_id, title, body, updated_by) VALUES
    ('demo-material', 'material', 'demo-course', 'demo-teacher', '演示讲义', '', 'demo-teacher')
ON CONFLICT(id) DO NOTHING;
INSERT INTO file_versions (id, material_id, filename, version, status) VALUES
    ('demo-version-1', 'demo-material', '演示讲义-v1.pdf', 1, 'visible'),
    ('demo-version-2', 'demo-material', '演示讲义-v2.pdf', 2, 'visible')
ON CONFLICT(id) DO NOTHING;