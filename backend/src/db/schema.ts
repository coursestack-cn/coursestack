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

export const accountCreationRequests = sqliteTable('account_creation_requests', {
    actorId: text('actor_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    requestKey: text('request_key').notNull(),
    accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    requestHash: text('request_hash').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
    primaryKey({ columns: [t.actorId, t.requestKey] }),
    uniqueIndex('account_creation_requests_account').on(t.accountId),
]);

// The course number is the primary key; offerings and teachers are independent.
export const courses = sqliteTable('courses', {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    introduction: text('introduction').notNull().default(''),
    createdBy: text('created_by').notNull().references(() => accounts.id),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
}, (t) => [
    check('courses_name', sql`length(trim(${t.name})) > 0`),
    check('courses_id', sql`length(trim(${t.id})) > 0`),
    uniqueIndex('courses_request_unique').on(t.createdBy, t.requestKey),
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

// An administrator schedules an offering, even before any teacher joins it.
export const courseTerms = sqliteTable('course_terms', {
    courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'restrict' }),
    termId: text('term_id').notNull().references(() => terms.id, { onDelete: 'restrict' }),
}, (t) => [
    primaryKey({ columns: [t.courseId, t.termId] }),
    index('course_terms_term').on(t.termId, t.courseId),
]);

export const teachingClasses = sqliteTable('teaching_classes', {
    courseId: text('course_id').notNull(),
    termId: text('term_id').notNull(),
    teacherId: text('teacher_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
}, (t) => [
    primaryKey({ columns: [t.courseId, t.termId, t.teacherId] }),
    foreignKey({ columns: [t.courseId, t.termId], foreignColumns: [courseTerms.courseId, courseTerms.termId] }).onDelete('restrict'),
    index('teaching_classes_teacher_term').on(t.teacherId, t.termId, t.courseId),
]);

export const classStudents = sqliteTable('class_students', {
    courseId: text('course_id').notNull(),
    termId: text('term_id').notNull(),
    studentId: text('student_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
    teacherId: text('teacher_id').notNull(),
}, (t) => [
    // A student can belong to only one teacher in each course and term.
    primaryKey({ columns: [t.courseId, t.termId, t.studentId] }),
    foreignKey({ columns: [t.courseId, t.termId, t.teacherId], foreignColumns: [teachingClasses.courseId, teachingClasses.termId, teachingClasses.teacherId] }).onDelete('restrict'),
    index('class_students_student_term').on(t.studentId, t.termId, t.courseId),
    index('class_students_class').on(t.courseId, t.termId, t.teacherId, t.studentId),
]);

// Joining a teaching class initializes its rules, with all rewards disabled.
export const classBonusRules = sqliteTable('class_bonus_rules', {
    courseId: text('course_id').notNull(),
    termId: text('term_id').notNull(),
    teacherId: text('teacher_id').notNull(),
    pointsQuestion: integer('points_question').notNull().default(0),
    pointsAnswer: integer('points_answer').notNull().default(0),
    pointsAcceptance: integer('points_acceptance').notNull().default(0),
    pointsComment: integer('points_comment').notNull().default(0),
    pointsMaterial: integer('points_material').notNull().default(0),
    pointsMaterialVersion: integer('points_material_version').notNull().default(0),
}, (t) => [
    primaryKey({ columns: [t.courseId, t.termId, t.teacherId] }),
    foreignKey({ columns: [t.courseId, t.termId, t.teacherId], foreignColumns: [teachingClasses.courseId, teachingClasses.termId, teachingClasses.teacherId] }).onDelete('restrict'),
    ...[t.pointsQuestion, t.pointsAnswer, t.pointsAcceptance, t.pointsComment, t.pointsMaterial, t.pointsMaterialVersion].map(column =>
        check(`class_bonus_rules_${column.name}`, sql`${column} BETWEEN 0 AND 9007199254740991`)),
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
    storageKey: text('storage_key').notNull(),
    size: integer('size').notNull(),
    mime: text('mime').notNull(),
    uploadedBy: text('uploaded_by').notNull().references(() => accounts.id),
    updatedBy: text('updated_by').notNull().references(() => accounts.id),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (t) => [
    primaryKey({ columns: [t.materialId, t.version] }),
    check('file_versions_version', sql`${t.version} > 0`),
    check('file_versions_size', sql`${t.size} > 0 AND ${t.size} <= 9007199254740991`),
    uniqueIndex('file_versions_storage_unique').on(t.storageKey),
]);

// Counters survive version removal, so a historical version URL is never reused.
export const materialNextVersions = sqliteTable('material_next_versions', {
    materialId: text('material_id').primaryKey().notNull().references(() => contents.id),
    nextVersion: integer('next_version').notNull(),
}, t => [check('material_next_versions_version', sql`${t.nextVersion} > 0`)]);

export const materialUploadSessions = sqliteTable('material_upload_sessions', {
    id: text('id').primaryKey().notNull(),
    ownerId: text('owner_id').notNull().references(() => accounts.id),
    courseId: text('course_id').notNull().references(() => courses.id),
    // A new material ID is reserved here and only becomes a content row on publication.
    materialId: text('material_id').notNull(),
    mode: text('mode', { enum: ['create', 'version'] }).notNull(),
    creationDraft: text('creation_draft'),
    expectedSize: integer('expected_size').notNull(),
    mime: text('mime').notNull(),
    status: text('status', { enum: ['pending', 'confirming', 'published', 'cancelled', 'expired'] }).notNull().default('pending'),
    resultVersion: integer('result_version'),
    leaseToken: text('lease_token'),
    leaseUntil: integer('lease_until'),
    putExpiresAt: integer('put_expires_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    cleanedAt: integer('cleaned_at'),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
}, t => [
    uniqueIndex('material_upload_sessions_request_unique').on(t.ownerId, t.requestKey),
    index('material_upload_sessions_cleanup').on(t.expiresAt, t.cleanedAt),
    check('material_upload_sessions_mode', sql`${t.mode} IN ('create', 'version')`),
    check('material_upload_sessions_status', sql`${t.status} IN ('pending', 'confirming', 'published', 'cancelled', 'expired')`),
    check('material_upload_sessions_size', sql`${t.expectedSize} > 0 AND ${t.expectedSize} <= 9007199254740991`),
    check('material_upload_sessions_creation_draft', sql`${t.creationDraft} IS NULL OR json_valid(${t.creationDraft})`),
    check('material_upload_sessions_result', sql`(${t.status} = 'published') = (${t.resultVersion} IS NOT NULL) AND (${t.resultVersion} IS NULL OR ${t.resultVersion} > 0)`),
    check('material_upload_sessions_lease', sql`(${t.status} = 'confirming') = (${t.leaseToken} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL)`),
]);

export const contents = sqliteTable('contents', {
    id: text('id').primaryKey().notNull(),
    kind: text('kind', { enum: ['material', 'question', 'answer', 'comment'] }).notNull(),
    courseId: text('course_id').notNull().references(() => courses.id),
    termId: text('term_id').references(() => terms.id, { onDelete: 'restrict' }),
    authorId: text('author_id').notNull().references(() => accounts.id),
    title: text('title'),
    body: text('body'),
    bodyText: text('body_text').notNull().default(''),
    tags: text('tags'),
    targetId: text('target_id'),
    // Comments belong to a question, answer or material; replies never own other comments.
    replyToId: text('reply_to_id'),
    status: text('status', { enum: ['visible', 'hidden', 'deleted'] }).notNull().default('visible'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    editedAt: integer('edited_at'),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
    updatedBy: text('updated_by').notNull().references(() => accounts.id),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
}, (t) => [
    foreignKey({ columns: [t.targetId], foreignColumns: [t.id] }),
    foreignKey({ columns: [t.replyToId], foreignColumns: [t.id] }),
    check('contents_body_json', sql`${t.body} IS NULL OR json_valid(${t.body})`),
    check('contents_deleted_payload', sql`${t.status} <> 'deleted' OR (${t.title} IS NULL AND ${t.body} IS NULL AND ${t.tags} IS NULL)`),
    check('contents_kind', sql`${t.kind} IN ('material', 'question', 'answer', 'comment')`),
    check('contents_tags', sql`${t.tags} IS NULL OR (${t.kind} IN ('question', 'material') AND json_valid(${t.tags}) AND json_type(${t.tags}) = 'array')`),
    check('contents_status', sql`${t.status} IN ('visible', 'hidden', 'deleted')`),
    check('contents_shape', sql`(${t.kind} IN ('material', 'question') AND (${t.title} IS NOT NULL OR ${t.status} = 'deleted') AND ${t.targetId} IS NULL)
        OR (${t.kind} IN ('answer', 'comment') AND ${t.title} IS NULL AND ${t.targetId} IS NOT NULL)`),
    uniqueIndex('contents_request_unique').on(t.authorId, t.requestKey),
    index('contents_course_kind_time').on(t.courseId, t.kind, t.status, t.createdAt, t.id),
    index('contents_course_term_kind_time').on(t.courseId, t.termId, t.kind, t.status, t.createdAt, t.id),
    index('contents_target').on(t.targetId, t.status),
    index('contents_reply').on(t.replyToId),
    index('contents_author').on(t.authorId, t.kind, t.createdAt, t.id),
]);

// Each insertion owns its own R2 object at body-images/<id>.
export const contentImages = sqliteTable('content_images', {
    id: text('id').primaryKey().notNull(),
    uploadedBy: text('uploaded_by').notNull().references(() => accounts.id),
    contentId: text('content_id').references(() => contents.id),
    draftUploadId: text('draft_upload_id').references(() => materialUploadSessions.id),
    cleanupAt: integer('cleanup_at'),
}, t => [
    check('content_images_owner', sql`(${t.contentId} IS NOT NULL) + (${t.draftUploadId} IS NOT NULL) + (${t.cleanupAt} IS NOT NULL) = 1`),
    index('content_images_content').on(t.contentId).where(sql`${t.contentId} IS NOT NULL`),
    index('content_images_draft').on(t.draftUploadId).where(sql`${t.draftUploadId} IS NOT NULL`),
    index('content_images_cleanup').on(t.cleanupAt).where(sql`${t.cleanupAt} IS NOT NULL`),
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
    teacherId: text('teacher_id').notNull(),
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
    // The enrollment's transfer and removal triggers keep ledger attribution in sync.
    foreignKey({ columns: [t.courseId, t.termId, t.teacherId], foreignColumns: [teachingClasses.courseId, teachingClasses.termId, teachingClasses.teacherId] }).onDelete('restrict'),
    check('bonus_ledger_source_kind', sql`${t.sourceKind} IN ('question', 'answer', 'acceptance', 'comment', 'material', 'manual')`),
    check('bonus_ledger_delta', sql`${t.deltaPoints} <> 0 AND abs(${t.deltaPoints}) <= 9007199254740991`),
    check('bonus_ledger_shape', sql`(${t.sourceKind} = 'manual' AND ${t.reversesId} IS NULL AND ${t.requestHash} IS NOT NULL)
        OR (${t.sourceKind} <> 'manual' AND ${t.requestHash} IS NULL
            AND (${t.reversesId} IS NOT NULL OR ${t.deltaPoints} > 0))`),
    uniqueIndex('bonus_original_award').on(t.sourceKind, t.sourceId).where(sql`${t.sourceKind} <> 'manual' AND ${t.reversesId} IS NULL`),
    uniqueIndex('bonus_reversal_once').on(t.reversesId),
    index('bonus_student_reversals').on(t.courseId, t.studentId).where(sql`${t.reversesId} IS NOT NULL`),
    uniqueIndex('bonus_manual_request').on(t.operatorId, t.sourceId).where(sql`${t.sourceKind} = 'manual'`),
    index('bonus_course_term_student').on(t.courseId, t.termId, t.studentId),
    index('bonus_class_student').on(t.courseId, t.termId, t.teacherId, t.studentId),
]);

export const reports = sqliteTable('reports', {
    id: text('id').primaryKey().notNull(),
    contentId: text('content_id').notNull().references(() => contents.id),
    reporterId: text('reporter_id').notNull().references(() => accounts.id),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['pending', 'resolved', 'dismissed', 'deleted'] }).notNull().default('pending'),
    resolution: text('resolution'),
    handledBy: text('handled_by').references(() => accounts.id),
    handledAt: integer('handled_at'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
}, (t) => [
    check('reports_status', sql`${t.status} IN ('pending', 'resolved', 'dismissed', 'deleted')`),
    uniqueIndex('reports_request_unique').on(t.reporterId, t.requestKey),
    uniqueIndex('one_pending_report').on(t.contentId, t.reporterId).where(sql`${t.status} = 'pending'`),
    index('reports_queue').on(t.status, t.createdAt, t.id),
]);

export const moderationActions = sqliteTable('moderation_actions', {
    // A version deletion keeps its audit entry after the file version is removed.
    version: integer('version'),
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

// Retained for upgrading existing read receipts; new reads live in notifications.
export const moderationNotificationReads = sqliteTable('moderation_notification_reads', {
    actionId: integer('action_id').notNull().references(() => moderationActions.id),
    accountId: text('account_id').notNull().references(() => accounts.id),
    readAt: integer('read_at').notNull().default(sql`(unixepoch())`),
}, t => [primaryKey({ columns: [t.actionId, t.accountId] })]);

// One inbox entry per recipient and source event. Content text stays in contents.
export const notifications = sqliteTable('notifications', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id').notNull().references(() => accounts.id),
    actorId: text('actor_id').notNull().references(() => accounts.id),
    kind: text('kind', { enum: ['answer', 'comment', 'reply', 'accepted', 'unaccepted', 'moderation', 'bonus', 'favorite'] }).notNull(),
    sourceId: text('source_id').notNull(),
    eventId: integer('event_id').references(() => contentEvents.id),
    contentId: text('content_id').references(() => contents.id),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    readAt: integer('read_at'),
}, t => [
    check('notifications_kind', sql`${t.kind} IN ('answer', 'comment', 'reply', 'accepted', 'unaccepted', 'moderation', 'bonus', 'favorite')`),
    uniqueIndex('notifications_recipient_event').on(t.accountId, t.eventId),
    uniqueIndex('notifications_recipient_source').on(t.accountId, t.kind, t.sourceId),
    index('notifications_recipient_order').on(t.accountId, t.id),
    index('notifications_unread').on(t.accountId, t.id).where(sql`${t.readAt} IS NULL`),
    index('notifications_read').on(t.accountId, t.id).where(sql`${t.readAt} IS NOT NULL`),
]);


export const favorites = sqliteTable('favorites', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id').notNull().references(() => accounts.id),
    courseId: text('course_id').references(() => courses.id),
    contentId: text('content_id').references(() => contents.id),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, t => [
    check('favorites_target', sql`(${t.courseId} IS NULL) <> (${t.contentId} IS NULL)`),
    uniqueIndex('favorites_account_course').on(t.accountId, t.courseId),
    uniqueIndex('favorites_account_content').on(t.accountId, t.contentId),
    index('favorites_account_order').on(t.accountId, t.createdAt, t.id),
    index('favorites_subscribers').on(t.contentId, t.accountId),
]);

// Immutable events carry references only; reads always recheck current public visibility.
export const contentEvents = sqliteTable('content_events', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceKey: text('source_key').notNull(),
    kind: text('kind', { enum: ['question_created', 'material_created', 'material_version', 'answer_created', 'comment_created', 'content_edited', 'acceptance_changed'] }).notNull(),
    courseId: text('course_id').notNull().references(() => courses.id),
    rootId: text('root_id').notNull().references(() => contents.id),
    contentId: text('content_id').notNull().references(() => contents.id),
    actorId: text('actor_id').notNull().references(() => accounts.id),
    version: integer('version'),
    oldAnswerId: text('old_answer_id').references(() => contents.id),
    newAnswerId: text('new_answer_id').references(() => contents.id),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, t => [
    uniqueIndex('content_events_source').on(t.sourceKey),
    index('content_events_feed').on(t.courseId, t.createdAt, t.id),
    check('content_events_kind', sql`${t.kind} IN ('question_created','material_created','material_version','answer_created','comment_created','content_edited','acceptance_changed')`),
    check('content_events_version', sql`${t.version} IS NULL OR ${t.version}>0`),
]);