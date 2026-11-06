import { and, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { Database } from './db/index.ts';
import { accounts, teachingClasses, terms } from './db/schema.ts';
import { createDatabase } from './db/index.ts';
import { HttpError } from './http.ts';
import { actor } from './auth/middleware.ts';
import type { Actor, Ctx } from './discussions/types.ts';

// A request's entry authentication survives logout/disable/reset. Deleting its
// identity is the sole exception; the check and business write share one SQL transaction.
export function activeUser(a: Actor): SQL {
    return sql`EXISTS(SELECT 1 FROM accounts account WHERE account.id=${a.id}
        AND account.status<>'deleted')`;
}
export function administration(a: Actor): SQL {
    return sql`(${a.role}='admin' AND ${activeUser(a)})`;
}
export async function requireAdministrator(c: Ctx) {
    const a = actor(c);
    if (!await createDatabase(c.env.DB).get(sql`SELECT 1 WHERE ${administration(a)}`)) {
        throw new HttpError(403, 'ADMIN_REQUIRED', '需要管理员权限');
    }
    return a;
}
export function management(a: Actor, course: SQL): SQL {
    return sql`(${activeUser(a)} AND (${a.role}='admin' OR (${a.role}='teacher' AND EXISTS(
        SELECT 1 FROM teaching_classes assignment
        JOIN terms term ON term.id=assignment.term_id AND term.current=1
        WHERE assignment.teacher_id=${a.id} AND assignment.course_id=${course}))))`;
}
export function classManagement(a: Actor, course: SQL, term: SQL, teacher: SQL): SQL {
    return sql`(${activeUser(a)} AND (${a.role}='admin' OR (${a.role}='teacher' AND ${teacher}=${a.id} AND EXISTS(
        SELECT 1 FROM teaching_classes assignment JOIN terms semester ON semester.id=assignment.term_id AND semester.current=1
        WHERE assignment.course_id=${course} AND assignment.term_id=${term} AND assignment.teacher_id=${a.id}))))`;
}
export function editPermission(a: Actor, _course: SQL, author: SQL): SQL {
    return sql`(${author}=${a.id} AND ${activeUser(a)})`;
}
export async function requireManagement(c: Ctx, courseId: string) {
    const a = actor(c);
    if (!await createDatabase(c.env.DB).get(sql`SELECT 1 WHERE ${management(a, sql`${courseId}`)}`)) {
        throw new HttpError(403, 'COURSE_PERMISSION_DENIED', '需要本学期课程教师或管理员权限');
    }
    return a;
}
export async function isAdministrator(db: Database, actorId: string | null): Promise<boolean> {
    if (!actorId) return false;
    return !!await db.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.id, actorId), eq(accounts.status, 'active'), eq(accounts.role, 'admin'))).get();
}
export async function isCurrentCourseTeacher(db: Database, actorId: string | null, courseId: string): Promise<boolean> {
    if (!actorId) return false;
    return !!await db.select({ id: accounts.id }).from(accounts)
        .innerJoin(teachingClasses, eq(teachingClasses.teacherId, accounts.id))
        .innerJoin(terms, and(eq(terms.id, teachingClasses.termId), eq(terms.current, 1)))
        .where(and(eq(accounts.id, actorId), eq(accounts.role, 'teacher'), eq(accounts.status, 'active'), eq(teachingClasses.courseId, courseId))).get();
}

/** Whitelist public fields; a deleted identity exposes only its placeholder. */
export async function getPublicProfile(db: Database, accountId: string) {
    const row = await db.select({ id: accounts.id, nickname: accounts.nickname, avatarKey: accounts.avatarKey, status: accounts.status })
        .from(accounts).where(and(eq(accounts.id, accountId), ne(accounts.status, 'disabled'))).get();
    if (!row) return null;
    const isDeleted = row.status === 'deleted';
    return { id: row.id, nickname: isDeleted ? '已删除' : row.nickname, isDeleted,
        avatarUrl: !isDeleted && row.avatarKey ? `/api/profiles/${encodeURIComponent(row.id)}/avatar` : null };
}