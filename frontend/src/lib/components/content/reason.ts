export const REPORT_CATEGORIES = ["垃圾广告", "不友善", "侵权或抄袭", "与课程无关", "其他"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReasonResult = { ok: true; reason: string } | { ok: false; field: "category" | "detail"; message: string };

export function reasonLength(value: string): number {
    return Array.from(value).length;
}

export function reportReason(category: string, detail: string): ReasonResult {
    if (!REPORT_CATEGORIES.some((value) => value === category)) {
        return { ok: false, field: "category", message: "选择举报类别。" };
    }
    const explanation = detail.trim();
    if (category === "其他" && !explanation) {
        return { ok: false, field: "detail", message: "补充举报说明。" };
    }
    const reason = explanation ? `${category}：${explanation}` : category;
    if (reasonLength(reason) < 3 || reasonLength(reason) > 1000) {
        return { ok: false, field: "detail", message: "举报理由须为 3–1000 字，包含类别和分隔符。" };
    }
    return { ok: true, reason };
}

export function moderationReason(detail: string): ReasonResult {
    const reason = detail.trim();
    if (reasonLength(reason) < 3 || reasonLength(reason) > 1000) {
        return { ok: false, field: "detail", message: "填写 3–1000 字的下架原因。" };
    }
    return { ok: true, reason };
}