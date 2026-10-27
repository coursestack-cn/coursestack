import type { RichTextDoc } from "../rich-text/types.js";

export type AuthorView = {
    id: string;
    nickname: string | null;
    isDeleted: boolean;
    isTeacher: boolean;
    isCourseTeacher: boolean;
    avatarUrl?: string | null;
};

export type ReplyTarget = {
    id: string;
    nickname: string | null;
    authorDeleted: boolean;
    contentDeleted: boolean;
    href?: string;
};

export type VisibleCommentView = {
    kind: "visible";
    id: string;
    author: AuthorView;
    body: RichTextDoc;
    createdAt: number;
    editedAt?: number | null;
    score: number;
    myVote: -1 | 0 | 1;
    replyTo?: ReplyTarget | null;
};

export type DeletedCommentView = {
    kind: "deleted";
    id: string;
    createdAt?: number;
    replyTo?: ReplyTarget | null;
};

export type CommentView = VisibleCommentView | DeletedCommentView;
export type VoteState = "enabled" | "self" | "anonymous" | "readonly";
export type ContentKind = "question" | "answer" | "comment" | "material";

/** Calculated by the page; these flags never replace server authorization. */
export type ContentCapabilities = {
    canEdit?: boolean;
    canDelete?: boolean;
    canReport?: boolean;
    canModerate?: boolean;
    canAccept?: boolean;
    canReply?: boolean;
};