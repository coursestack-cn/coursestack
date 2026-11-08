import type { HighlightRange } from "../../../../shared/search";
export type SearchItem = {
    id: string; kind: "course" | "material" | "question" | "answer"; title: string; excerpt: string;
    course: { id: string; name: string }; tags: string[]; questionId: string | null; updatedAt: number;
    author: { id: string | null; nickname: string | null; isTeacher: boolean; isDeleted: boolean; avatarUrl: string | null } | null;
    highlights: { title: HighlightRange[]; excerpt: HighlightRange[] };
};
export type SearchPage = { items: SearchItem[]; page: number; pageSize: number; total: number; q: string; type: string; sort: string };