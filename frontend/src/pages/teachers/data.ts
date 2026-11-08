import type { CourseContent } from "../materials/data";
import type { Page } from "../questions/data";

export const teacherTabs = [
    { value: "courses", kind: "course", label: "授课课程", empty: "暂无授课课程" },
    { value: "materials", kind: "material", label: "资料", empty: "暂无公开资料" },
    { value: "questions", kind: "question", label: "提问", empty: "暂无公开提问" },
    { value: "answers", kind: "answer", label: "回答", empty: "暂无公开回答" },
    { value: "comments", kind: "comment", label: "评论", empty: "暂无公开评论" }
] as const;
export type TeacherCounts = Record<typeof teacherTabs[number]["value"], number>;
export type TeacherProfile = { id: string; nickname: string | null; avatarUrl: string | null; isTeacher: true; isDeleted: false };
export type TeacherCourse = { kind: "course"; id: string; name: string; introduction: string; terms: { id: string; name: string; current: boolean }[] };
export type TeacherContent = CourseContent & {
    courseName: string;
    root: { id: string; kind: "question" | "material"; title: string };
    quote: { kind: "answer" | "comment"; available: boolean; author: { nickname: string | null; isDeleted: boolean } | null; excerpt: string | null } | null;
};
export type TeacherActivity = Page<TeacherCourse | TeacherContent> & { kind: typeof teacherTabs[number]["kind"] };