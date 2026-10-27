import type { Context } from 'hono';
import type { Env } from '../env.ts';

export type Actor = { id: string; nickname: string; role: 'student' | 'teacher' | 'admin'; tokenHash: string; version: number; dataGeneration: number };
export type AppEnv = {
    Bindings: Env;
    Variables: { actor: Actor | null; requestId: string };
};
export type Ctx = Context<AppEnv>;
export type ContentRow = {
    id: string; kind: 'material' | 'question' | 'answer' | 'comment'; course_id: string; author_id: string;
    title: string | null; body: string; tags: string | null;
    target_kind: ContentRow['kind'] | null; target_id: string | null;
    status: string; revision: number; created_at: number; updated_at: number;
    accepted_answer_id: string | null; accepted_by: string | null; accepted_at: number | null;
    accepted_term_id: string | null; acceptance_id: string | null; award_cents: number; award_eligible: number;
    request_hash: string | null;
};
export type PublicRow = ContentRow & { author_name: string; author_role: string | null; author_deleted: number; course_teacher: number; score: number; my_vote: number };