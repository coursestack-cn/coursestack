import { integer, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

// Shared table contracts: ownership remains with members 1 and 4.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), displayName: text('display_name').notNull(),
  role: text('role', { enum: ['student', 'teacher', 'admin'] }).notNull(), active: integer('active').notNull(),
});
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull(), expiresAt: text('expires_at').notNull(),
});
export const semesters = sqliteTable('semesters', {
  id: text('id').primaryKey(), name: text('name').notNull(), status: text('status').notNull(),
});
export const courseTeachers = sqliteTable('course_teachers', {
  courseId: text('course_id').notNull(), userId: text('user_id').notNull(), semesterId: text('semester_id').notNull(),
}, t => [primaryKey({ columns: [t.courseId, t.userId, t.semesterId] })]);
export const enrollments = sqliteTable('enrollments', {
  courseId: text('course_id').notNull(), userId: text('user_id').notNull(), semesterId: text('semester_id').notNull(),
}, t => [primaryKey({ columns: [t.courseId, t.userId, t.semesterId] })]);
export const materials = sqliteTable('materials', {
  id: text('id').primaryKey(), courseId: text('course_id').notNull(), authorId: text('author_id').notNull(),
  title: text('title').notNull(), status: text('status').notNull(),
});
export const fileVersions = sqliteTable('file_versions', {
  id: text('id').primaryKey(), materialId: text('material_id').notNull(), filename: text('filename').notNull(),
  version: integer('version').notNull(), status: text('status').notNull(),
});
export const courses = sqliteTable('courses', {
  id: text('id').primaryKey(), name: text('name').notNull(), code: text('code').notNull(),
  department: text('department').notNull(), introduction: text('introduction').notNull(),
  createdBy: text('created_by').notNull(), updatedBy: text('updated_by').notNull(), bonusEnabled: integer('bonus_enabled').notNull(),
  bonusCents: integer('bonus_cents').notNull(), revision: integer('revision').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  requestKey: text('request_key').notNull(), requestHash: text('request_hash').notNull(),
});
export const contents = sqliteTable('contents', {
  id: text('id').primaryKey(), kind: text('kind', { enum: ['question', 'answer', 'comment'] }).notNull(),
  courseId: text('course_id').notNull(), authorId: text('author_id').notNull(),
  title: text('title'), body: text('body').notNull(), tags: text('tags').notNull(),
  questionId: text('question_id'), targetKind: text('target_kind'), targetId: text('target_id'),
  replyToId: text('reply_to_id'), fileVersionId: text('file_version_id'), status: text('status').notNull(),
  revision: integer('revision').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(), changeReason: text('change_reason').notNull(),
  acceptedAnswerId: text('accepted_answer_id'), acceptedBy: text('accepted_by'), acceptedAt: text('accepted_at'),
  acceptedSemesterId: text('accepted_semester_id'), acceptanceId: text('acceptance_id'),
  awardCents: integer('award_cents').notNull(), awardEligible: integer('award_eligible').notNull(),
  requestKey: text('request_key').notNull(), requestHash: text('request_hash').notNull(),
});
export const votes = sqliteTable('votes', {
  contentId: text('content_id').notNull(), userId: text('user_id').notNull(),
  value: integer('value').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.contentId, t.userId] })]);
export const bonusLedger = sqliteTable('bonus_ledger', {
  id: integer('id').primaryKey(), acceptanceId: text('acceptance_id').notNull(), operation: text('operation').notNull(),
  courseId: text('course_id').notNull(), questionId: text('question_id').notNull(), answerId: text('answer_id').notNull(),
  studentId: text('student_id').notNull(), semesterId: text('semester_id').notNull(), teacherId: text('teacher_id').notNull(),
  operatorId: text('operator_id').notNull(), deltaCents: integer('delta_cents').notNull(),
  reason: text('reason').notNull(), createdAt: text('created_at').notNull(),
});
export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(), contentId: text('content_id').notNull(), reporterId: text('reporter_id').notNull(),
  reason: text('reason').notNull(), status: text('status').notNull(), resolution: text('resolution'),
  handledBy: text('handled_by'), handledAt: text('handled_at'), revision: integer('revision').notNull(),
  createdAt: text('created_at').notNull(), requestKey: text('request_key').notNull(), requestHash: text('request_hash').notNull(),
});
export const moderationActions = sqliteTable('moderation_actions', {
  id: integer('id').primaryKey(), contentId: text('content_id').notNull(), actorId: text('actor_id').notNull(),
  oldStatus: text('old_status').notNull(), newStatus: text('new_status').notNull(),
  reason: text('reason').notNull(), createdAt: text('created_at').notNull(),
});
export const businessEvents = sqliteTable('business_events', {
  seq: integer('seq').primaryKey(), eventId: text('event_id').notNull(), type: text('type').notNull(),
  courseId: text('course_id').notNull(), contentId: text('content_id'), actorId: text('actor_id').notNull(),
  payload: text('payload').notNull(), createdAt: text('created_at').notNull(), acknowledgedAt: text('acknowledged_at'),
});