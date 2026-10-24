import { and, eq, exists } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Database } from './db/index.ts';
import { accounts, accountRoles, academicSettings, enrollments, studentRecords, teachingAssignments } from './db/schema.ts';

// actorId must come from a verified server-side session, never request input.
export async function isAdministrator(db: Database, actorId: string | null): Promise<boolean> {
  if (!actorId) return false;
  const row = await db.select({ id: accounts.id }).from(accounts)
    .innerJoin(accountRoles, eq(accountRoles.accountId, accounts.id))
    .where(and(eq(accounts.id, actorId), eq(accounts.status, 'active'), eq(accountRoles.role, 'admin'))).get();
  return !!row;
}

export async function isCurrentCourseTeacher(db: Database, actorId: string | null, courseId: string): Promise<boolean> {
  if (!actorId) return false;
  const row = await db.select({ id: accounts.id }).from(accounts)
    .innerJoin(teachingAssignments, eq(teachingAssignments.teacherId, accounts.id))
    .innerJoin(academicSettings, and(eq(academicSettings.id, 1), eq(academicSettings.currentTermId, teachingAssignments.termId)))
    .where(and(eq(accounts.id, actorId), eq(accounts.status, 'active'), eq(teachingAssignments.courseId, courseId))).get();
  return !!row;
}

/** Explicit public projection: adding private columns later cannot expose them here. */
export async function getPublicProfile(db: Database, accountId: string) {
  const row = await db.select({ id: accounts.id, publicName: accounts.publicName, avatarKey: accounts.avatarKey }).from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.status, 'active'))).get() ?? null;
  if (!row) return null;
  return { id: row.id, publicName: row.publicName, avatarUrl: row.avatarKey ? `/api/profiles/${encodeURIComponent(row.id)}/avatar` : null };
}

/** Teachers can read only current students of the specified current teaching course. */
export async function getStudentRecordForTeacher(
  db: Database, actorId: string | null, courseId: string, studentId: string,
) {
  if (!actorId) return null;
  const teacher = alias(accounts, 'teacher');
  // Authorization and private projection are one SQL statement, so a precheck
  // cannot become stale between checking the term and retrieving personal data.
  return await db.select({
    accountId: studentRecords.accountId,
    studentNumber: studentRecords.studentNumber,
    realName: studentRecords.realName,
  }).from(studentRecords)
    .innerJoin(enrollments, eq(enrollments.studentId, studentRecords.accountId))
    .innerJoin(academicSettings, and(eq(academicSettings.id, 1), eq(academicSettings.currentTermId, enrollments.termId)))
    .innerJoin(teachingAssignments, and(
      eq(teachingAssignments.courseId, enrollments.courseId),
      eq(teachingAssignments.termId, enrollments.termId),
      eq(teachingAssignments.teacherId, actorId),
    ))
    .innerJoin(teacher, and(eq(teacher.id, teachingAssignments.teacherId), eq(teacher.status, 'active')))
    .where(and(eq(enrollments.courseId, courseId), eq(studentRecords.accountId, studentId))).get() ?? null;
}

/** Separate administrator scope: a global management role is not a teaching role. */
export async function getStudentRecordForAdministrator(db: Database, actorId: string | null, studentId: string) {
  if (!actorId) return null;
  const authorized = db.select({ id: accounts.id }).from(accounts)
    .innerJoin(accountRoles, eq(accountRoles.accountId, accounts.id))
    .where(and(eq(accounts.id, actorId), eq(accounts.status, 'active'), eq(accountRoles.role, 'admin')));
  return await db.select({
    accountId: studentRecords.accountId,
    studentNumber: studentRecords.studentNumber,
    realName: studentRecords.realName,
  }).from(studentRecords).where(and(eq(studentRecords.accountId, studentId), exists(authorized))).get() ?? null;
}