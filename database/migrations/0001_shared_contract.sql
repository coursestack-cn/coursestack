-- Local integration contract for member 1 (identity/term) and member 4 (files).
-- Reconcile these tables with their owners before merging into the shared DB.
PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE semesters (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','archived','planned'))
);
CREATE UNIQUE INDEX one_active_semester ON semesters(status) WHERE status='active';
-- course_id FKs deliberately reference courses, created by migration 0002.
CREATE TABLE course_teachers (
  course_id TEXT NOT NULL REFERENCES courses(id), user_id TEXT NOT NULL REFERENCES users(id),
  semester_id TEXT NOT NULL REFERENCES semesters(id), PRIMARY KEY(course_id,user_id,semester_id)
);
CREATE TABLE enrollments (
  course_id TEXT NOT NULL REFERENCES courses(id), user_id TEXT NOT NULL REFERENCES users(id),
  semester_id TEXT NOT NULL REFERENCES semesters(id), PRIMARY KEY(course_id,user_id,semester_id)
);
CREATE TABLE materials (
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id),
  author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('visible','hidden','deleted'))
);
CREATE TABLE file_versions (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
  filename TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  status TEXT NOT NULL CHECK(status IN ('visible','hidden','deleted')),
  UNIQUE(material_id,version)
);