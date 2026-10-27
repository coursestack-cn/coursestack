import type { AuthorView } from "./types.js";

export function displayName(author: Pick<AuthorView, "nickname" | "isDeleted">): string {
    if (author.isDeleted) return "已删除";
    return author.nickname?.trim() || "未设置昵称";
}