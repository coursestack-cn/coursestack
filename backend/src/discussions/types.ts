import type { Context } from 'hono';
import type { Env } from '../env.ts';

export type Actor = { id: string; nickname: string | null; role: 'student' | 'teacher' | 'admin'; tokenHash: string; version: number };
export type AppEnv = {
    Bindings: Env;
    Variables: { actor: Actor | null; requestId: string };
};
export type Ctx = Context<AppEnv>;
export type ContentRow = {
    id: string; kind: 'material' | 'question' | 'answer' | 'comment'; course_id: string; term_id: string | null; author_id: string;
    title: string | null; body: string | null; tags: string | null;
    target_id: string | null; reply_to_id: string | null;
    status: string; created_at: number; edited_at: number | null; updated_at: number;
    acceptedAnswerId: string | null;
    request_hash: string;
};
export type PublicRow = ContentRow & {
    parent_kind: ContentRow['kind'] | null;
    author_name: string | null; author_role: string | null; author_deleted: number; course_teacher: number; score: number; my_vote: number;
    author_avatar_key: string | null;
    reply_summary_id: string | null; reply_to_name: string | null; reply_to_author_deleted: number | null; reply_to_deleted: number | null;
    answer_count: number; comment_count: number; publicly_visible: number; can_delete: number;
};