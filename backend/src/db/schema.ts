import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// All timestamps are Unix seconds. Public identity and academic records stay separate.
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey().notNull(),
  publicName: text('public_name').notNull(),
  status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  lastLoginAt: integer('last_login_at'),
  revision: integer('revision').notNull().default(1),
  avatarKey: text('avatar_key'),
}, (t) => [
  check('accounts_public_name', sql`length(trim(${t.publicName})) BETWEEN 1 AND 80`),
  check('accounts_status', sql`${t.status} IN ('active', 'disabled')`),
  check('accounts_revision', sql`${t.revision} > 0`),
]);

export const accountRoles = sqliteTable('account_roles', {
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  role: text('role', { enum: ['student', 'teacher', 'admin'] }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.accountId, t.role] }),
  check('account_roles_role', sql`${t.role} IN ('student', 'teacher', 'admin')`),
  uniqueIndex('account_roles_single_admin').on(t.role).where(sql`${t.role} = 'admin'`),
]);

export const studentRecords = sqliteTable('student_records', {
  accountId: text('account_id').primaryKey().notNull(),
  role: text('role').notNull().default('student'),
  studentNumber: text('student_number').notNull(),
  realName: text('real_name').notNull(),
}, (t) => [
  uniqueIndex('student_records_number_unique').on(t.studentNumber),
  check('student_records_role', sql`${t.role} = 'student'`),
  check('student_records_number', sql`length(trim(${t.studentNumber})) > 0`),
  check('student_records_name', sql`length(trim(${t.realName})) > 0`),
  foreignKey({ columns: [t.accountId, t.role], foreignColumns: [accountRoles.accountId, accountRoles.role] }).onDelete('restrict'),
]);

// Minimal shared course identity; course information and APIs belong to member 3.
export const courses = sqliteTable('courses', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [check('courses_name', sql`length(trim(${t.name})) > 0`)]);

export const terms = sqliteTable('terms', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
}, (t) => [check('terms_name', sql`length(trim(${t.name})) > 0`)]);

// A single configured term avoids inventing a school calendar or rollover time.
export const academicSettings = sqliteTable('academic_settings', {
  id: integer('id').primaryKey(),
  currentTermId: text('current_term_id').references(() => terms.id, { onDelete: 'restrict' }),
}, (t) => [check('academic_settings_singleton', sql`${t.id} = 1`)]);

export const teachingAssignments = sqliteTable('teaching_assignments', {
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'restrict' }),
  termId: text('term_id').notNull().references(() => terms.id, { onDelete: 'restrict' }),
  teacherId: text('teacher_id').notNull(),
  role: text('role').notNull().default('teacher'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
  primaryKey({ columns: [t.courseId, t.termId, t.teacherId] }),
  index('teaching_assignments_teacher_term').on(t.teacherId, t.termId, t.courseId),
  check('teaching_assignments_role', sql`${t.role} = 'teacher'`),
  foreignKey({ columns: [t.teacherId, t.role], foreignColumns: [accountRoles.accountId, accountRoles.role] }).onDelete('restrict'),
]);

export const enrollments = sqliteTable('enrollments', {
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'restrict' }),
  termId: text('term_id').notNull().references(() => terms.id, { onDelete: 'restrict' }),
  studentId: text('student_id').notNull(),
  role: text('role').notNull().default('student'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
  primaryKey({ columns: [t.courseId, t.termId, t.studentId] }),
  index('enrollments_student_term').on(t.studentId, t.termId, t.courseId),
  check('enrollments_role', sql`${t.role} = 'student'`),
  foreignKey({ columns: [t.studentId, t.role], foreignColumns: [accountRoles.accountId, accountRoles.role] }).onDelete('restrict'),
]);

export const credentials = sqliteTable('credentials', {
  accountId: text('account_id').primaryKey().notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  schoolNumber: text('school_number').unique(),
  passwordHash: text('password_hash').notNull(),
  version: integer('version').notNull().default(1),
}, (t) => [check('credentials_version', sql`${t.version} > 0`)]);

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey().notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  credentialVersion: integer('credential_version').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => [index('sessions_account').on(t.accountId), index('sessions_expiry').on(t.expiresAt)]);

export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey().notNull(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => [index('login_attempts_expiry').on(t.expiresAt)]);

export const accountPrivate = sqliteTable('account_private', {
  accountId: text('account_id').primaryKey().notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  realName: text('real_name'),
  email: text('email').unique(),
  emailVerifiedAt: integer('email_verified_at'),
  emailVersion: integer('email_version').notNull().default(1),
}, (t) => [check('account_private_email_version', sql`${t.emailVersion} > 0`)]);

export const accountAudit = sqliteTable('account_audit', {
  id: text('id').primaryKey().notNull(),
  actorId: text('actor_id').references(() => accounts.id, { onDelete: 'restrict' }),
  targetId: text('target_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  fields: text('fields').notNull(),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [index('account_audit_target_time').on(t.targetId, t.createdAt, t.id)]);

export const emailTokens = sqliteTable('email_tokens', {
  tokenHash: text('token_hash').primaryKey().notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  purpose: text('purpose', { enum: ['verify-email', 'reset-password'] }).notNull(),
  emailVersion: integer('email_version').notNull(),
  credentialVersion: integer('credential_version').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => [
  check('email_tokens_purpose', sql`${t.purpose} IN ('verify-email', 'reset-password')`),
  index('email_tokens_account').on(t.accountId),
  index('email_tokens_expiry').on(t.expiresAt),
]);

export const avatarObjects = sqliteTable('avatar_objects', {
  objectKey: text('object_key').primaryKey().notNull(),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});