export type Notice = {
    id: number; type: "answer" | "comment" | "reply" | "accepted" | "unaccepted" | "moderation" | "bonus";
    contentId: string | null; kind: "question" | "answer" | "comment" | "material" | null;
    title: string | null; courseId: string; courseName: string; createdAt: number; readAt: number | null;
    available: boolean; isPublic: boolean; status: string | null; contentStatus: string | null;
    version: number | null; reason: string; deltaPoints: number | null; href: string | null;
};
export type NoticeFilter = "unread" | "read" | "all";
export type NoticeBatch = { viewer: string; items: Notice[]; unreadCount: number;
    nextCursor: number | null; hasMore: boolean; readThroughId: number | null };
export const matchesNoticeFilter = (item: Notice, filter: NoticeFilter) => filter === "all" || (filter === "read" ? item.readAt !== null : item.readAt === null);

// A full fresh batch may leave an unknown gap before the cached list. Never splice across that gap.
export function mergeNotices(old: Notice[], fresh: NoticeBatch, states: Notice[], filter: NoticeFilter) {
    const stateById = new Map(states.map(item => [item.id, item]));
    const waiting = old.length > 0 && fresh.hasMore && fresh.items.length > 0 && fresh.items.at(-1)!.id > old[0]!.id;
    const combined = new Map<number, Notice>();
    for (const item of [...old, ...(waiting ? [] : fresh.items)]) combined.set(item.id, stateById.get(item.id) ?? item);
    return { items: [...combined.values()].filter(item => matchesNoticeFilter(item, filter)).sort((a, b) => b.id - a.id), waiting };
}

export function noticeHeading(item: Notice): string {
    const labels = { answer: "你的问题收到了新回答", comment: "你的内容收到了新评论", reply: "你的评论收到了回复",
        accepted: "你的回答已被采纳", unaccepted: "你的回答已取消采纳" };
    if (item.type === "bonus") return `你的课程积分已调整：${(item.deltaPoints ?? 0) > 0 ? "+" : ""}${item.deltaPoints} 分`;
    if (item.type !== "moderation") return labels[item.type];
    if (item.version !== null) return `你的资料版本 ${item.version} 已删除`;
    if (item.status === "deleted") return "你的内容已删除";
    if (item.status === "hidden") return "你的内容已下架";
    return item.isPublic ? "你的内容已重新上架" : "你的内容已解除下架限制";
}