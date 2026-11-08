export type BonusPolicy = { pointsQuestion: number; pointsAnswer: number; pointsAcceptance: number;
    pointsComment: number; pointsMaterial: number; pointsMaterialVersion: number };
export type Term = { id: string; name: string; current: boolean };
export type Teacher = { id: string; nickname: string | null; isDeleted: boolean };
export type Course = { id: string; name: string; introduction: string; currentTerm: Pick<Term, "id" | "name"> | null;
    offeredInCurrentTerm: boolean; currentTeachers: Teacher[]; createdAt: number; updatedAt: number };
export type TeachingClass = { courseId: string; termId: string; teacherId: string; course: Pick<Course, "id" | "name">;
    term: Term; teacher: Teacher; studentCount: number; bonusPolicy: BonusPolicy };
export type TeachingClassKey = Pick<TeachingClass, "courseId" | "termId" | "teacherId">;
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
export const classUrl = (value: TeachingClassKey) => `/api/courses/${encodeURIComponent(value.courseId)}/terms/${encodeURIComponent(value.termId)}/teachers/${encodeURIComponent(value.teacherId)}`;
export const courseClassesHref = (courseCode: string) => `/manage/courses/${encodeURIComponent(courseCode)}/classes`;
export const classStudentsHref = (value: TeachingClassKey) => `${courseClassesHref(value.courseId)}/${encodeURIComponent(value.termId)}/${encodeURIComponent(value.teacherId)}/students`;
/** A teacher manages only their own current-term class, which course, term and teacher identify, so their entry skips the class list. */
export const courseManageHref = (course: Pick<Course, "id" | "currentTerm">, viewer: { id: string; role: string } | null | undefined) =>
    viewer?.role === "teacher" && course.currentTerm ? classStudentsHref({ courseId: course.id, termId: course.currentTerm.id, teacherId: viewer.id }) : courseClassesHref(course.id);
export const teacherLabel = (teacher: Teacher) => teacher.isDeleted ? "已删除" : teacher.nickname ?? "未设置昵称";
export const pageNumber = (value: string | null) => {
    const number = Number(value ?? 1);
    return Number.isSafeInteger(number) && number >= 1 && number <= 10000 ? number : 1;
};
export const pageCount = (value: Page<unknown>) => Math.max(1, Math.min(10000, Math.ceil(value.total / value.pageSize)));