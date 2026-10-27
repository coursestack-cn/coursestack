import type { Context } from 'hono';
import type { Env } from '../env.ts';

export type Actor = { id: string; nickname: string | null; role: 'student' | 'teacher' | 'admin'; tokenHash: string; version: number };
export type AppEnv = {
    Bindings: Env;
    Variables: { actor: Actor | null; requestId: string };
};
export type Ctx = Context<AppEnv>;
export type ContentRow = {
    id: string; kind: 'material' | 'question' | 'answer' | 'comment'; course_id: string; author_id: string;
    title: string | null; body: string | null; tags: string | null;
    target_kind: ContentRow['kind'] | null; target_id: string | null;
    status: string; revision: number; created_at: number; updated_at: number;
    acceptedAnswerId: string | null;
    request_hash: string;
};
export type PublicRow = ContentRow & { author_name: string | null; author_role: string | null; author_deleted: number; course_teacher: number; score: number; my_vote: number };