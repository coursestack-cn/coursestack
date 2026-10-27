-- Refuse ambiguous legacy identity data rather than choosing one copy silently.
CREATE TABLE __account_merge_guard (ok INTEGER CONSTRAINT account_identity_merge_conflict CHECK (ok = 1));
--> statement-breakpoint
INSERT INTO __account_merge_guard SELECT 0 FROM accounts a
WHERE (SELECT COUNT(*) FROM account_roles r WHERE r.account_id = a.id) <> 1
   OR EXISTS (SELECT 1 FROM student_records s JOIN account_private p ON p.account_id = s.account_id
              WHERE s.account_id = a.id AND p.real_name IS NOT NULL AND p.real_name <> s.real_name)
   OR EXISTS (SELECT 1 FROM student_records s JOIN credentials c ON c.account_id = s.account_id
              WHERE s.account_id = a.id AND c.school_number IS NOT NULL AND c.school_number <> s.student_number);
--> statement-breakpoint
DROP TABLE __account_merge_guard;
--> statement-breakpoint
ALTER TABLE accounts RENAME COLUMN public_name TO nickname;
--> statement-breakpoint
ALTER TABLE accounts RENAME COLUMN status TO previous_status;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CONSTRAINT accounts_status CHECK (status IN ('active', 'disabled', 'deleted'));
--> statement-breakpoint
UPDATE accounts SET status = previous_status;
--> statement-breakpoint
ALTER TABLE accounts DROP COLUMN previous_status;
--> statement-breakpoint
ALTER TABLE accounts DROP COLUMN revision;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'student' CONSTRAINT accounts_role CHECK (role IN ('student', 'teacher', 'admin'));
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN school_number TEXT;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN password TEXT;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT false CONSTRAINT accounts_must_change_password CHECK (must_change_password IN (0, 1));
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 1 CONSTRAINT accounts_credential_version CHECK (credential_version > 0);
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN data_generation INTEGER NOT NULL DEFAULT 1 CONSTRAINT accounts_data_generation CHECK (data_generation > 0);
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN name TEXT;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN department TEXT;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN major TEXT;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN grade TEXT;
--> statement-breakpoint
UPDATE accounts SET
    role = (SELECT role FROM account_roles WHERE account_id = accounts.id),
    school_number = COALESCE((SELECT school_number FROM credentials WHERE account_id = accounts.id),
                            (SELECT student_number FROM student_records WHERE account_id = accounts.id)),
    password = (SELECT password_hash FROM credentials WHERE account_id = accounts.id),
    must_change_password = COALESCE((SELECT must_change_password FROM credentials WHERE account_id = accounts.id), 0),
    credential_version = COALESCE((SELECT version FROM credentials WHERE account_id = accounts.id), 1),
    name = COALESCE((SELECT real_name FROM account_private WHERE account_id = accounts.id),
                    (SELECT real_name FROM student_records WHERE account_id = accounts.id));
--> statement-breakpoint
CREATE UNIQUE INDEX accounts_school_number_unique ON accounts(school_number) WHERE status <> 'deleted';
--> statement-breakpoint
CREATE UNIQUE INDEX accounts_single_admin ON accounts(role) WHERE role = 'admin';
--> statement-breakpoint
CREATE TABLE __new_teaching_assignments (
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
    teacher_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (course_id, term_id, teacher_id)
);
--> statement-breakpoint
INSERT INTO __new_teaching_assignments SELECT course_id, term_id, teacher_id, created_at FROM teaching_assignments;
--> statement-breakpoint
DROP TABLE teaching_assignments;
--> statement-breakpoint
ALTER TABLE __new_teaching_assignments RENAME TO teaching_assignments;
--> statement-breakpoint
CREATE INDEX teaching_assignments_teacher_term ON teaching_assignments(teacher_id, term_id, course_id);
--> statement-breakpoint
CREATE TABLE __new_enrollments (
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
    student_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (course_id, term_id, student_id)
);
--> statement-breakpoint
INSERT INTO __new_enrollments SELECT course_id, term_id, student_id, created_at FROM enrollments;
--> statement-breakpoint
DROP TABLE enrollments;
--> statement-breakpoint
ALTER TABLE __new_enrollments RENAME TO enrollments;
--> statement-breakpoint
CREATE INDEX enrollments_student_term ON enrollments(student_id, term_id, course_id);
--> statement-breakpoint
DROP TABLE student_records;
--> statement-breakpoint
DROP TABLE account_roles;
--> statement-breakpoint
DROP TABLE credentials;
--> statement-breakpoint
DROP TABLE account_private;
--> statement-breakpoint
DROP TABLE avatar_objects;
--> statement-breakpoint
CREATE TRIGGER teaching_identity_insert BEFORE INSERT ON teaching_assignments
WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.teacher_id AND role = 'teacher' AND status <> 'deleted')
BEGIN SELECT RAISE(ABORT, 'invalid_teacher_identity'); END;
--> statement-breakpoint
CREATE TRIGGER teaching_identity_update BEFORE UPDATE ON teaching_assignments
WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.teacher_id AND role = 'teacher' AND status <> 'deleted')
BEGIN SELECT RAISE(ABORT, 'invalid_teacher_identity'); END;
--> statement-breakpoint
CREATE TRIGGER enrollment_identity_insert BEFORE INSERT ON enrollments
WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.student_id AND role = 'student' AND status <> 'deleted')
BEGIN SELECT RAISE(ABORT, 'invalid_student_identity'); END;
--> statement-breakpoint
CREATE TRIGGER enrollment_identity_update BEFORE UPDATE ON enrollments
WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.student_id AND role = 'student' AND status <> 'deleted')
BEGIN SELECT RAISE(ABORT, 'invalid_student_identity'); END;
--> statement-breakpoint
CREATE TRIGGER account_role_immutable BEFORE UPDATE OF role ON accounts
WHEN NEW.role <> OLD.role
BEGIN SELECT RAISE(ABORT, 'replace_account_identity'); END;