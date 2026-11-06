export const REPORT_CATEGORIES = ["垃圾广告", "不友善", "侵权或抄袭", "与课程无关", "其他"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReasonResult = { ok: true; reason: string } | { ok: false; message: string };

export function reasonLength(value: string): number {
    return Array.from(value).length;
}

export function reportText(category: string, detail: string): string {
    const explanation = detail.trim();
    return category && explanation ? `${category}：${explanation}` : category || explanation;
}

export function reportReason(category: string, detail: string): ReasonResult {
    const reason = reportText(category, detail);
    if (reasonLength(reason) > 1000) {
        return { ok: false, message: "举报理由最多 1000 字，包含类别和分隔符。" };
    }
    return { ok: true, reason };
}

export function moderationReason(detail: string): ReasonResult {
    const reason = detail.trim();
    if (reasonLength(reason) > 1000) {
        return { ok: false, message: "下架原因最多 1000 字。" };
    }
    return { ok: true, reason };
}