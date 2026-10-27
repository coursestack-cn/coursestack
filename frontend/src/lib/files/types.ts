export type FileKind = "pdf" | "image" | "document" | "spreadsheet" | "presentation" | "archive" | "other";

export type UploadRequest = { name: string; size: number; type: string };

/** A frontend draft. Backend adapters must map the eventual duplicate response. */
export type UploadDuplicate = { kind: "same-file"; name?: string };

export type UploadTicket = {
    uploadId: string;
    url: string;
    headers: Record<string, string>;
    /** Unix seconds, matching other CourseStack timestamps. */
    expiresAt?: number;
    duplicate?: UploadDuplicate;
};

export type UploadBackend<T> = {
    prepare(request: UploadRequest, signal: AbortSignal): Promise<UploadTicket>;
    confirm(uploadId: string, signal: AbortSignal): Promise<T>;
};

export type UploadStage = "validating" | "preparing" | "uploading" | "confirming";
export type UploadStatus = "idle" | UploadStage | "awaiting-duplicate" | "done" | "failed" | "cancelled";
export type UploadFailure = {
    stage: UploadStage;
    code: string;
    /** A frontend-owned message; never a raw service error or storage response. */
    message: string;
    status?: number;
};

export type UploadSnapshot<T = unknown> = {
    status: UploadStatus;
    file: File | null;
    loaded: number;
    total: number;
    failure?: UploadFailure;
    duplicate?: UploadDuplicate;
    result?: T;
};

export type UploadController<T> = {
    readonly state: Readonly<UploadSnapshot<T>>;
    readonly busy: boolean;
    subscribe(listener: (state: Readonly<UploadSnapshot<T>>) => void): () => void;
    start(file: File): Promise<void>;
    retry(): Promise<void>;
    continueDuplicate(): Promise<void>;
    cancel(): void;
    reset(): void;
    dispose(): void;
};