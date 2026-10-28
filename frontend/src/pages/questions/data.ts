import { api, ApiError } from "$lib/api/client";
import { EMPTY_DOC, toPlainText, validateDoc, type RichTextDoc } from "$lib/rich-text/index";
import type { AuthorView, CommentView, ContentCapabilities, VoteState } from "$lib/content/types";
import { entityId, urlId } from "$lib/router/ids";
export { urlId } from "$lib/router/ids";

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
export type Course = { id: string; code: string; name: string };
export type CourseEntry = { course: Course; permissions: { canManage: boolean } };
type Parent = { id: string; author: { nickname: string | null; isDeleted: boolean }; isDeleted: boolean };
export type Content = {
    id: string; kind: "question" | "answer" | "comment" | "material"; courseId: string;
    status?: "visible"; author: AuthorView; title: string | null; body: RichTextDoc | null;
    tags: string[] | null; targetKind: Content["kind"] | null; targetId: string | null;
    createdAt: number; editedAt: number | null; updatedAt: number; replyTo: Parent | null;
    score: number; myVote: -1 | 0 | 1; commentCount: number;
    answerCount?: number; solved?: boolean; acceptedAnswerId?: string | null; isAccepted?: boolean;
};
export type Tombstone = Pick<Content, "id" | "courseId" | "targetId" | "targetKind" | "replyTo" | "editedAt" | "commentCount"> & {
    kind: "comment"; status: "deleted"; body: null;
};
export type Comment = Content | Tombstone;
export const encode = encodeURIComponent;
export const questionHref = (id: string) => `/questions/${encode(urlId(id))}`;
export const courseQuestionsHref = (course: Course) => `/courses/${encode(course.code)}/questions`;
export const pageNumber = (value: string | null) => {
    const number = Number(value ?? 1);
    return Number.isInteger(number) && number >= 1 && number <= 10000 ? number : 1;
};
export const pageCount = (data: Page<unknown>) => Math.max(1, Math.min(10000, Math.ceil(data.total / data.pageSize)));
export const emptyDoc = () => structuredClone(EMPTY_DOC);

export async function courseByCode(code: string, signal: AbortSignal): Promise<CourseEntry> {
    const query = new URLSearchParams({ code, pageSize: "1" });
    const courses = await api.get<Page<Course>>(`/api/courses?${query}`, { signal });
    const course = courses.items[0];
    if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "课程不存在");
    return courseEntry(course.id, signal);
}
export const courseEntry = (id: string, signal: AbortSignal) => api.get<CourseEntry>(`/api/courses/${encode(id)}/entry`, { signal });
export const getContent = (id: string, signal?: AbortSignal) => api.get<Comment>(`/api/contents/${encode(id)}`, { signal });
export function commentView(item: Comment): CommentView {
    const replyTo = item.replyTo ? { id: item.replyTo.id, nickname: item.replyTo.author.nickname,
        authorDeleted: item.replyTo.author.isDeleted, contentDeleted: item.replyTo.isDeleted,
        href: `/${item.targetKind === "comment" ? "comments" : item.targetKind === "answer" ? "answers" : item.targetKind === "material" ? "materials" : "questions"}/${encode(urlId(item.replyTo.id))}` } : null;
    return item.status === "deleted" ? { kind: "deleted", id: urlId(item.id), replyTo }
        : { kind: "visible", id: urlId(item.id), author: item.author, body: item.body ?? emptyDoc(), createdAt: item.createdAt,
            editedAt: item.editedAt, score: item.score, myVote: item.myVote, replyTo };
}
export function blockView(item: Content) {
    return { ...item, id: urlId(item.id), kind: item.kind as "question" | "answer", body: item.body ?? emptyDoc(), accepted: item.isAccepted };
}
export function questionView(item: Content) {
    const doc = validateDoc(item.body);
    return { ...item, title: item.title ?? "问题", href: questionHref(item.id), tags: item.tags ?? [], solved: Boolean(item.solved),
        excerpt: doc.ok ? toPlainText(doc.doc, { maxChars: 180 }) : "" };
}
export function capabilities(authorId: string, viewerId: string | undefined, canManage: boolean): ContentCapabilities {
    const signedIn = Boolean(viewerId);
    return { canEdit: signedIn && (authorId === viewerId || canManage), canDelete: signedIn && (authorId === viewerId || canManage),
        canReport: signedIn, canModerate: signedIn && canManage, canAccept: signedIn && canManage, canReply: signedIn };
}
export function voteState(authorId: string, viewerId: string | undefined, sessionStatus: string): VoteState {
    return sessionStatus === "loading" ? "readonly" : !viewerId ? "anonymous" : authorId === viewerId ? "self" : "enabled";
}

/** Retain the key for an unchanged retry, including a lost success response. */
export function publisher() {
    let previous = "", key = "";
    return {
        async post<T>(path: string, body: unknown, viewerId: string, signal?: AbortSignal): Promise<T> {
            const fingerprint = JSON.stringify([viewerId, path, body]);
            if (fingerprint !== previous) { previous = fingerprint; key = crypto.randomUUID(); }
            return api.post<T>(path, body, { signal, headers: { "Idempotency-Key": key } });
        },
        reset() { previous = ""; key = ""; }
    };
}

export function contentActions(viewer: () => string | undefined) {
    const reports = new Map<string, ReturnType<typeof publisher>>();
    return {
        vote: (id: string, value: -1 | 0 | 1) => api.put<{ score: number; myVote: -1 | 0 | 1 }>(`/api/contents/${encode(id)}/vote`, { value }),
        remove: (id: string) => api.delete(`/api/contents/${encode(id)}`),
        hide: (id: string, reason: string) => api.put(`/api/contents/${encode(id)}/moderation`, { action: "hide", reason }),
        async report(id: string, reason: string) {
            const request = reports.get(id) ?? publisher();
            reports.set(id, request);
            await request.post(`/api/contents/${encode(id)}/reports`, { reason }, viewer() ?? "");
        }
    };
}

/** Resolve direct-parent chains without assuming the parent is on the current page. */
export async function locateContent(id: string, expected: "answer" | "comment", signal: AbortSignal) {
    let current = await getContent(entityId(id), signal);
    if (current.kind !== expected) throw new ApiError(404, "CONTENT_UNAVAILABLE", "内容不可用");
    const commentId = expected === "comment" ? current.id : undefined;
    let answerId: string | undefined;
    const seen = new Set<string>();
    while (current.kind === "comment" || current.kind === "answer") {
        if (seen.has(current.id) || !current.targetId) throw new ApiError(404, "CONTENT_UNAVAILABLE", "内容不可用");
        seen.add(current.id);
        if (current.kind === "answer") answerId = current.id;
        current = await getContent(current.targetId, signal);
    }
    if (current.kind !== "question" && current.kind !== "material") throw new ApiError(404, "CONTENT_UNAVAILABLE", "内容不可用");
    return { root: current, answerId, commentId };
}

export async function findItemPage<T extends { id: string }>(path: string, id: string, signal: AbortSignal, size = 20) {
    for (let page = 1; page <= 10000; page++) {
        const separator = path.includes("?") ? "&" : "?";
        const result = await api.get<Page<T>>(`${path}${separator}page=${page}&pageSize=${size}`, { signal });
        if (result.items.some(item => item.id === id)) return result;
        if (page >= pageCount(result) || result.items.length === 0) break;
    }
    return null;
}