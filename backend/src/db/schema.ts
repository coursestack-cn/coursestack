import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// All timestamps are Unix seconds. Public APIs select an explicit subset of account fields.
// scripts/lib/schema.mjs emits all tables as STRICT; CHECKs below enforce business rules.
export const accounts = sqliteTable('accounts', {
    id: text('id').primaryKey().notNull(),
    nickname: text('nickname'),
    role: text('role', { enum: ['student', 'teacher', 'admin'] }).notNull().default('student'),
    status: text('status', { enum: ['active', 'disabled', 'deleted'] }).notNull().default('active'),
    schoolNumber: text('school_number'),
    // A null hash means login has not been provisioned, or the identity was retired.
    password: text('password'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
    credentialVersion: integer('credential_version').notNull().default(1),
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
    check('accounts_must_change_password', sql`${t.mustChangePassword} IN (0, 1)`),
    // Live students and teachers log in by school number; the administrator never has one.
    check('accounts_school_number', sql`${t.status} = 'deleted' OR (${t.role} = 'admin') = (${t.schoolNumber} IS NULL)`),
    uniqueIndex('accounts_school_number_unique').on(t.schoolNumber).where(sql`${t.status} <> 'deleted'`),
    uniqueIndex('accounts_single_admin').on(t.role).where(sql`${t.role} = 'admin'`),
]);

// A new course requires a current-term teacher row in the same transaction (rules.sql).
export const courses = sqliteTable('courses', {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    code: text('code').notNull(),
    introduction: text('introduction').notNull().default(''),
    createdBy: text('created_by').notNull().references(() => accounts.id),
    updatedBy: text('updated_by').notNull().references(() => accounts.id),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
}, (t) => [
    check('courses_name', sql`length(trim(${t.name})) > 0`),
    check('courses_code', sql`length(trim(${t.code})) > 0`),
    uniqueIndex('courses_code_unique').on(t.code),
    uniqueIndex('courses_request_unique').on(t.createdBy, t.requestKey),
]);

// Course creation initializes one rule row, with all rewards disabled by default.
export const courseBonusRules = sqliteTable('course_bonus_rules', {
    id: text('id').primaryKey().notNull().references(() => courses.id, { onDelete: 'cascade' }),
    pointsQuestion: integer('points_question').notNull().default(0),
    pointsAnswer: integer('points_answer').notNull().default(0),
    pointsAcceptance: integer('points_acceptance').notNull().default(0),
    pointsComment: integer('points_comment').notNull().default(0),
    pointsMaterial: integer('points_material').notNull().default(0),
    pointsMaterialVersion: integer('points_material_version').notNull().default(0),
}, (t) => [
    ...[t.pointsQuestion, t.pointsAnswer, t.pointsAcceptance, t.pointsComment, t.pointsMaterial, t.pointsMaterialVersion].map(column =>
        check(`course_bonus_rules_${column.name}`, sql`${column} BETWEEN 0 AND 9007199254740991`)),
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

// Material metadata is a content row with kind='material'; member 4 owns file access.
export const fileVersions = sqliteTable('file_versions', {
    materialId: text('material_id').notNull().references(() => contents.id),
    version: integer('version').notNull(),
    filename: text('filename').notNull(),
    status: text('status', { enum: ['visible', 'hidden'] }).notNull().default('visible'),
    uploadedBy: text('uploaded_by').notNull().references(() => accounts.id),
    updatedBy: text('updated_by').notNull().references(() => accounts.id),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
    primaryKey({ columns: [t.materialId, t.version] }),
    check('file_versions_version', sql`${t.version} > 0`),
    check('file_versions_status', sql`${t.status} IN ('visible', 'hidden')`),
]);

export const contents = sqliteTable('contents', {
    id: text('id').primaryKey().notNull(),
    kind: text('kind', { enum: ['material', 'question', 'answer', 'comment'] }).notNull(),
    courseId: text('course_id').notNull().references(() => courses.id),
    authorId: text('author_id').notNull().references(() => accounts.id),
    title: text('title'),
    body: text('body'),
    tags: text('tags'),
    targetId: text('target_id'),
    status: text('status', { enum: ['visible', 'hidden', 'deleted'] }).notNull().default('visible'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    editedAt: integer('edited_at'),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
    updatedBy: text('updated_by').notNull().references(() => accounts.id),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
}, (t) => [
    foreignKey({ columns: [t.targetId], foreignColumns: [t.id] }),
    check('contents_body_json', sql`${t.body} IS NULL OR json_valid(${t.body})`),
    check('contents_deleted_payload', sql`${t.status} <> 'deleted' OR (${t.title} IS NULL AND ${t.body} IS NULL AND ${t.tags} IS NULL)`),
    check('contents_kind', sql`${t.kind} IN ('material', 'question', 'answer', 'comment')`),
    check('contents_tags', sql`${t.tags} IS NULL OR (${t.kind} IN ('question', 'material') AND json_valid(${t.tags}) AND json_type(${t.tags}) = 'array')`),
    check('contents_status', sql`${t.status} IN ('visible', 'hidden', 'deleted')`),
    check('contents_shape', sql`(${t.kind} IN ('material', 'question') AND (${t.title} IS NOT NULL OR ${t.status} = 'deleted') AND ${t.targetId} IS NULL)
        OR (${t.kind} IN ('answer', 'comment') AND ${t.title} IS NULL AND ${t.targetId} IS NOT NULL)`),
    uniqueIndex('contents_request_unique').on(t.authorId, t.requestKey),
    index('contents_course_kind_time').on(t.courseId, t.kind, t.status, t.createdAt, t.id),
    index('contents_target').on(t.targetId, t.status),
    index('contents_author').on(t.authorId, t.kind, t.createdAt, t.id),
]);

// One current acceptance per question. Rewards live exclusively in bonus_ledger.
export const acceptances = sqliteTable('acceptances', {
    questionId: text('question_id').primaryKey().notNull().references(() => contents.id),
    answerId: text('answer_id').notNull().references(() => contents.id),
    operatorId: text('operator_id').notNull().references(() => accounts.id),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [uniqueIndex('acceptances_answer_unique').on(t.answerId)]);

export const votes = sqliteTable('votes', {
    contentId: text('content_id').notNull().references(() => contents.id),
    userId: text('user_id').notNull().references(() => accounts.id),
    value: integer('value').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
    primaryKey({ columns: [t.contentId, t.userId] }),
    check('votes_value', sql`${t.value} IN (-1, 1)`),
]);

export const bonusLedger = sqliteTable('bonus_ledger', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    courseId: text('course_id').notNull().references(() => courses.id),
    termId: text('term_id').notNull().references(() => terms.id),
    studentId: text('student_id').notNull().references(() => accounts.id),
    deltaPoints: integer('delta_points').notNull(),
    sourceKind: text('source_kind', { enum: ['question', 'answer', 'acceptance', 'comment', 'material', 'manual'] }).notNull(),
    // Content ID, accepted answer ID, materialId@version, or a manual request key.
    // No source FK: deleting a file version must preserve its points history.
    sourceId: text('source_id').notNull(),
    operatorId: text('operator_id').notNull().references(() => accounts.id),
    reason: text('reason'),
    reversesId: integer('reverses_id'),
    requestHash: text('request_hash'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
    foreignKey({ columns: [t.reversesId], foreignColumns: [t.id] }),
    check('bonus_ledger_source_kind', sql`${t.sourceKind} IN ('question', 'answer', 'acceptance', 'comment', 'material', 'manual')`),
    check('bonus_ledger_delta', sql`${t.deltaPoints} <> 0 AND abs(${t.deltaPoints}) <= 9007199254740991`),
    check('bonus_ledger_shape', sql`(${t.sourceKind} = 'manual' AND ${t.reversesId} IS NULL AND ${t.requestHash} IS NOT NULL)
        OR (${t.sourceKind} <> 'manual' AND ${t.requestHash} IS NULL
            AND (${t.reversesId} IS NOT NULL OR ${t.deltaPoints} > 0))`),
    uniqueIndex('bonus_original_award').on(t.sourceKind, t.sourceId).where(sql`${t.sourceKind} <> 'manual' AND ${t.reversesId} IS NULL`),
    uniqueIndex('bonus_reversal_once').on(t.reversesId),
    uniqueIndex('bonus_manual_request').on(t.operatorId, t.sourceId).where(sql`${t.sourceKind} = 'manual'`),
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
    oldStatus: text('old_status', { enum: ['visible', 'hidden', 'deleted'] }).notNull(),
    newStatus: text('new_status', { enum: ['visible', 'hidden', 'deleted'] }).notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
    check('moderation_actions_old_status', sql`${t.oldStatus} IN ('visible', 'hidden', 'deleted')`),
    check('moderation_actions_new_status', sql`${t.newStatus} IN ('visible', 'hidden', 'deleted')`),
]);