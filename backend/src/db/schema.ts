import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// All timestamps are Unix seconds. Public APIs select an explicit subset of account fields.
export const accounts = sqliteTable('accounts', {
    id: text('id').primaryKey().notNull(),
    nickname: text('nickname').notNull(),
    role: text('role', { enum: ['student', 'teacher', 'admin'] }).notNull().default('student'),
    status: text('status', { enum: ['active', 'disabled', 'deleted'] }).notNull().default('active'),
    schoolNumber: text('school_number'),
    // A null hash means login has not been provisioned, or the identity was retired.
    password: text('password'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
    credentialVersion: integer('credential_version').notNull().default(1),
    dataGeneration: integer('data_generation').notNull().default(1),
    name: text('name'),
    department: text('department'),
    major: text('major'),
    grade: text('grade'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    lastLoginAt: integer('last_login_at'),
    avatarKey: text('avatar_key'),
}, (t) => [
    check('accounts_nickname', sql`length(trim(${t.nickname})) BETWEEN 1 AND 80`),
    check('accounts_role', sql`${t.role} IN ('student', 'teacher', 'admin')`),
    check('accounts_status', sql`${t.status} IN ('active', 'disabled', 'deleted')`),
    check('accounts_credential_version', sql`${t.credentialVersion} > 0`),
    check('accounts_data_generation', sql`${t.dataGeneration} > 0`),
    check('accounts_must_change_password', sql`${t.mustChangePassword} IN (0, 1)`),
    uniqueIndex('accounts_school_number_unique').on(t.schoolNumber).where(sql`${t.status} <> 'deleted'`),
    uniqueIndex('accounts_single_admin').on(t.role).where(sql`${t.role} = 'admin'`),
]);

// A new course requires a current-term teacher row in the same transaction (migration 0012).
export const courses = sqliteTable('courses', {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    code: text('code').notNull().default(''),
    department: text('department').notNull().default(''),
    introduction: text('introduction').notNull().default(''),
    createdBy: text('created_by').references(() => accounts.id),
    updatedBy: text('updated_by').references(() => accounts.id),
    bonusEnabled: integer('bonus_enabled').notNull().default(0),
    bonusCents: integer('bonus_cents').notNull().default(200),
    revision: integer('revision').notNull().default(1),
    updatedAt: integer('updated_at'),
    requestKey: text('request_key'),
    requestHash: text('request_hash'),
}, (t) => [
    check('courses_name', sql`length(trim(${t.name})) > 0`),
    check('courses_bonus_enabled', sql`${t.bonusEnabled} IN (0, 1)`),
    check('courses_bonus_cents', sql`${t.bonusCents} BETWEEN 0 AND 10000`),
    check('courses_revision', sql`${t.revision} > 0`),
    uniqueIndex('courses_code_unique').on(t.code).where(sql`${t.code} <> ''`),
    uniqueIndex('courses_request_unique').on(t.createdBy, t.requestKey).where(sql`${t.requestKey} IS NOT NULL`),
]);

export const terms = sqliteTable('terms', {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    current: integer('current').notNull().default(0),
}, (t) => [
    check('terms_name', sql`length(trim(${t.name})) > 0`),
    check('terms_current', sql`${t.current} IN (0, 1)`),
    uniqueIndex('terms_one_current').on(t.current).where(sql`${t.current} = 1`),
]);

// SQL triggers enforce exactly one teacher per instance and current-term creation.
export const enrollments = sqliteTable('enrollments', {
    courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'restrict' }),
    termId: text('term_id').notNull().references(() => terms.id, { onDelete: 'restrict' }),
    accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
}, (t) => [
    primaryKey({ columns: [t.courseId, t.termId, t.accountId] }),
    index('enrollments_account_term').on(t.accountId, t.termId, t.courseId),
]);

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

export const accountAudit = sqliteTable('account_audit', {
    id: text('id').primaryKey().notNull(),
    actorId: text('actor_id').references(() => accounts.id, { onDelete: 'restrict' }),
    targetId: text('target_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    fields: text('fields').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [index('account_audit_target_time').on(t.targetId, t.createdAt, t.id)]);

// Material metadata is a content row with kind='material'; member 4 owns file access.
export const fileVersions = sqliteTable('file_versions', {
    id: text('id').primaryKey().notNull(),
    materialId: text('material_id').notNull().references(() => contents.id),
    filename: text('filename').notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: ['visible', 'hidden', 'deleted'] }).notNull(),
}, (t) => [
    check('file_versions_version', sql`${t.version} > 0`),
    check('file_versions_status', sql`${t.status} IN ('visible', 'hidden', 'deleted')`),
    uniqueIndex('file_versions_material_version').on(t.materialId, t.version),
]);

export const contents = sqliteTable('contents', {
    id: text('id').primaryKey().notNull(),
    kind: text('kind', { enum: ['material', 'question', 'answer', 'comment'] }).notNull(),
    courseId: text('course_id').notNull().references(() => courses.id),
    authorId: text('author_id').notNull().references(() => accounts.id),
    title: text('title'),
    body: text('body').notNull(),
    tags: text('tags'),
    targetKind: text('target_kind', { enum: ['material', 'question', 'answer', 'comment'] }),
    targetId: text('target_id'),
    status: text('status', { enum: ['visible', 'hidden', 'deleted'] }).notNull().default('visible'),
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
    updatedBy: text('updated_by').notNull().references(() => accounts.id),
    acceptedAnswerId: text('accepted_answer_id'),
    acceptedBy: text('accepted_by').references(() => accounts.id),
    acceptedAt: integer('accepted_at'),
    acceptedTermId: text('accepted_term_id').references(() => terms.id),
    acceptanceId: text('acceptance_id'),
    awardCents: integer('award_cents').notNull().default(0),
    awardEligible: integer('award_eligible').notNull().default(0),
    requestKey: text('request_key'),
    requestHash: text('request_hash'),
}, (t) => [
    foreignKey({ columns: [t.targetId], foreignColumns: [t.id] }),
    foreignKey({ columns: [t.acceptedAnswerId], foreignColumns: [t.id] }),
    check('contents_kind', sql`${t.kind} IN ('material', 'question', 'answer', 'comment')`),
    check('contents_tags', sql`${t.tags} IS NULL OR (${t.kind} IN ('question', 'material') AND json_valid(${t.tags}) AND json_type(${t.tags}) = 'array')`),
    check('contents_target_kind', sql`${t.targetKind} IN ('material', 'question', 'answer', 'comment')`),
    check('contents_status', sql`${t.status} IN ('visible', 'hidden', 'deleted')`),
    check('contents_award_cents', sql`${t.awardCents} BETWEEN 0 AND 10000`),
    check('contents_award_eligible', sql`${t.awardEligible} IN (0, 1)`),
    check('contents_shape', sql`(${t.kind} IN ('material', 'question') AND ${t.title} IS NOT NULL AND ${t.targetKind} IS NULL AND ${t.targetId} IS NULL)
        OR (${t.kind} = 'answer' AND ${t.title} IS NULL AND ${t.targetKind} IS 'question' AND ${t.targetId} IS NOT NULL)
        OR (${t.kind} = 'comment' AND ${t.title} IS NULL AND ${t.targetKind} IS NOT NULL AND ${t.targetId} IS NOT NULL)`),
    check('contents_question_fields', sql`${t.kind} = 'question' OR (${t.acceptedAnswerId} IS NULL AND ${t.awardCents} = 0)`),
    check('contents_request_pair', sql`(${t.requestKey} IS NULL AND ${t.requestHash} IS NULL) OR (${t.requestKey} IS NOT NULL AND ${t.requestHash} IS NOT NULL)`),
    check('contents_acceptance', sql`(${t.acceptedAnswerId} IS NULL AND ${t.acceptedBy} IS NULL AND ${t.acceptanceId} IS NULL AND ${t.awardCents} = 0)
        OR (${t.acceptedAnswerId} IS NOT NULL AND ${t.acceptedBy} IS NOT NULL AND ${t.acceptedAt} IS NOT NULL
        AND ${t.acceptedTermId} IS NOT NULL AND ${t.acceptanceId} IS NOT NULL)`),
    check('contents_award_qualification', sql`${t.awardCents} = 0 OR ${t.awardEligible} = 1`),
    uniqueIndex('contents_request_unique').on(t.authorId, t.requestKey),
    index('contents_course_kind_time').on(t.courseId, t.kind, t.status, t.createdAt, t.id),
    index('contents_target').on(t.targetKind, t.targetId, t.status),
    index('contents_author').on(t.authorId, t.kind, t.createdAt, t.id),
]);

export const votes = sqliteTable('votes', {
    contentId: text('content_id').notNull().references(() => contents.id),
    userId: text('user_id').notNull().references(() => accounts.id),
    value: integer('value').notNull(),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
    primaryKey({ columns: [t.contentId, t.userId] }),
    check('votes_value', sql`${t.value} IN (-1, 1)`),
]);

export const bonusLedger = sqliteTable('bonus_ledger', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    acceptanceId: text('acceptance_id').notNull(),
    operation: text('operation', { enum: ['award', 'revoke'] }).notNull(),
    courseId: text('course_id').notNull().references(() => courses.id),
    questionId: text('question_id').notNull().references(() => contents.id),
    answerId: text('answer_id').notNull().references(() => contents.id),
    studentId: text('student_id').notNull().references(() => accounts.id),
    termId: text('term_id').notNull().references(() => terms.id),
    teacherId: text('teacher_id').notNull().references(() => accounts.id),
    operatorId: text('operator_id').notNull().references(() => accounts.id),
    deltaCents: integer('delta_cents').notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
    check('bonus_ledger_operation', sql`${t.operation} IN ('award', 'revoke')`),
    check('bonus_ledger_delta', sql`${t.deltaCents} <> 0`),
    uniqueIndex('bonus_ledger_acceptance_operation').on(t.acceptanceId, t.operation),
    index('bonus_course_term_student').on(t.courseId, t.termId, t.studentId),
]);

export const reports = sqliteTable('reports', {
    id: text('id').primaryKey().notNull(),
    contentId: text('content_id').notNull().references(() => contents.id),
    reporterId: text('reporter_id').notNull().references(() => accounts.id),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['pending', 'resolved', 'dismissed'] }).notNull().default('pending'),
    resolution: text('resolution'),
    handledBy: text('handled_by').references(() => accounts.id),
    handledAt: integer('handled_at'),
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
}, (t) => [
    check('reports_status', sql`${t.status} IN ('pending', 'resolved', 'dismissed')`),
    uniqueIndex('reports_request_unique').on(t.reporterId, t.requestKey),
    uniqueIndex('one_pending_report').on(t.contentId, t.reporterId).where(sql`${t.status} = 'pending'`),
    index('reports_queue').on(t.status, t.createdAt, t.id),
]);

export const moderationActions = sqliteTable('moderation_actions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contentId: text('content_id').notNull().references(() => contents.id),
    actorId: text('actor_id').notNull().references(() => accounts.id),
    oldStatus: text('old_status').notNull(),
    newStatus: text('new_status').notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const businessEvents = sqliteTable('business_events', {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    courseId: text('course_id').notNull().references(() => courses.id),
    contentId: text('content_id').references(() => contents.id),
    actorId: text('actor_id').notNull().references(() => accounts.id),
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    acknowledgedAt: integer('acknowledged_at'),
}, (t) => [
    uniqueIndex('business_events_event_unique').on(t.eventId),
    check('business_events_payload', sql`json_valid(${t.payload})`),
    index('events_course_sequence').on(t.courseId, t.seq),
]);