CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  public_name TEXT NOT NULL CONSTRAINT accounts_public_name CHECK (length(trim(public_name)) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'active' CONSTRAINT accounts_status CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER
);
-- statement-breakpoint
CREATE TABLE account_roles (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CONSTRAINT account_roles_role CHECK (role IN ('student', 'teacher', 'admin')),
  PRIMARY KEY (account_id, role)
);
-- statement-breakpoint
CREATE TABLE student_records (
  account_id TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CONSTRAINT student_records_role CHECK (role = 'student'),
  student_number TEXT NOT NULL CONSTRAINT student_records_number CHECK (length(trim(student_number)) > 0),
  real_name TEXT NOT NULL CONSTRAINT student_records_name CHECK (length(trim(real_name)) > 0),
  FOREIGN KEY (account_id, role) REFERENCES account_roles(account_id, role) ON DELETE RESTRICT
);
-- statement-breakpoint
CREATE UNIQUE INDEX student_records_number_unique ON student_records(student_number);
-- statement-breakpoint
CREATE TABLE courses (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CONSTRAINT courses_name CHECK (length(trim(name)) > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- statement-breakpoint
CREATE TABLE terms (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CONSTRAINT terms_name CHECK (length(trim(name)) > 0)
);
-- statement-breakpoint
CREATE TABLE academic_settings (
  id INTEGER PRIMARY KEY CONSTRAINT academic_settings_singleton CHECK (id = 1),
  current_term_id TEXT REFERENCES terms(id) ON DELETE RESTRICT
);
-- statement-breakpoint
CREATE TABLE teaching_assignments (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
  teacher_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CONSTRAINT teaching_assignments_role CHECK (role = 'teacher'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (course_id, term_id, teacher_id),
  FOREIGN KEY (teacher_id, role) REFERENCES account_roles(account_id, role) ON DELETE RESTRICT
);
-- statement-breakpoint
CREATE INDEX teaching_assignments_teacher_term ON teaching_assignments(teacher_id, term_id, course_id);
-- statement-breakpoint
CREATE TABLE enrollments (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CONSTRAINT enrollments_role CHECK (role = 'student'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (course_id, term_id, student_id),
  FOREIGN KEY (student_id, role) REFERENCES account_roles(account_id, role) ON DELETE RESTRICT
);
-- statement-breakpoint
CREATE INDEX enrollments_student_term ON enrollments(student_id, term_id, course_id);
-- statement-breakpoint
INSERT INTO academic_settings (id, current_term_id) VALUES (1, NULL);