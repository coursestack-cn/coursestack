export type BonusPolicy = { pointsQuestion: number; pointsAnswer: number; pointsAcceptance: number;
    pointsComment: number; pointsMaterial: number; pointsMaterialVersion: number };
export type Course = { id: string; name: string; code: string; introduction: string; bonusPolicy: BonusPolicy;
    currentTeacher: { id: string; nickname: string | null; isDeleted: boolean } | null; createdAt: number; updatedAt: number };