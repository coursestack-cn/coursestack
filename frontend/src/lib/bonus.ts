import type { BonusPolicy, Teacher } from "../pages/manage/course";

export type BonusRecord = {
    id: number; courseId: string; courseName: string; termId: string; termName: string;
    teacherId: string; studentId: string; studentNickname: string | null; deltaPoints: number;
    sourceKind: "question" | "answer" | "acceptance" | "comment" | "material" | "manual";
    sourceId: string; operatorId: string; reason: string | null; reversesId: number | null; createdAt: number;
};
export type MyBonusPolicy = {
    courseId: string; currentTerm: { id: string; name: string } | null;
    membership: { teacher: Teacher; bonusPolicy: BonusPolicy } | null;
};
export type BonusEvents = { items: BonusRecord[]; nextCursor: number; hasMore: boolean };

export const bonusFields: { key: keyof BonusPolicy; label: string }[] = [
    { key: "pointsQuestion", label: "提问" },
    { key: "pointsAnswer", label: "回答" },
    { key: "pointsAcceptance", label: "回答被采纳" },
    { key: "pointsComment", label: "评论" },
    { key: "pointsMaterial", label: "资料首次上传" },
    { key: "pointsMaterialVersion", label: "资料新版本" }
];

export function bonusSourceLabel(record: BonusRecord): string {
    if (record.sourceKind === "manual") return record.deltaPoints > 0 ? "手动加分" : "手动扣分";
    const labels = { question: "提问", answer: "回答", acceptance: "回答被采纳", comment: "评论", material: "资料上传" };
    const source = record.sourceKind === "material"
        ? record.sourceId.endsWith("@1") ? "资料首次上传" : "资料新版本"
        : labels[record.sourceKind];
    return record.reversesId === null ? source : `${record.deltaPoints < 0 ? "撤回" : "恢复奖励"}：${source}`;
}

export const signedPoints = (points: number) => `${points > 0 ? "+" : ""}${points}`;
export const bonusHistoryHref = (courseId: string, termId: string) =>
    `/courses/${encodeURIComponent(courseId)}?${new URLSearchParams({ bonus: "history", bonusTerm: termId })}`;