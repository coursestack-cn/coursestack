export type BonusPolicy = { pointsQuestion: number; pointsAnswer: number; pointsAcceptance: number;
    pointsComment: number; pointsMaterial: number; pointsMaterialVersion: number };
export type Term = { id: string; name: string; current: boolean };
export type Teacher = { id: string; nickname: string | null; isDeleted: boolean };
export type Course = { id: string; name: string; introduction: string; currentTerm: Pick<Term, "id" | "name"> | null;
    offeredInCurrentTerm: boolean; currentTeachers: Teacher[]; createdAt: number; updatedAt: number };
export type TeachingClass = { courseId: string; termId: string; teacherId: string; course: Pick<Course, "id" | "name">;
    term: Term; teacher: Teacher; studentCount: number; bonusPolicy: BonusPolicy };
export const classUrl = (value: TeachingClass) => `/api/courses/${encodeURIComponent(value.courseId)}/terms/${encodeURIComponent(value.termId)}/teachers/${encodeURIComponent(value.teacherId)}`;