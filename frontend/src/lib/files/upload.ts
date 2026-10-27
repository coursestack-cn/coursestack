import type {
    UploadBackend, UploadController, UploadFailure, UploadSnapshot, UploadStage, UploadTicket,
} from "./types.js";
import { validateFile } from "./validation.js";
import { safeUploadUrl } from "./urls.js";

export type UploadOptions<T> = { backend: UploadBackend<T>; maxBytes: number; timeoutMs?: number };

class UploadIssue extends Error {
    readonly code: string;
    readonly status: number | undefined;

    constructor(code: string, message: string, status?: number) {
        super(message);
        this.name = "UploadIssue";
        this.code = code;
        this.status = status;
    }
}

function abortError(): DOMException {
    return new DOMException("Upload cancelled", "AbortError");
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => { signal.removeEventListener("abort", abort); };
        const abort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(abortError());
        };
        signal.addEventListener("abort", abort, { once: true });
        operation.then(value => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        }, error => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        });
        if (signal.aborted) abort();
    });
}

function normalizedTicket(input: UploadTicket): UploadTicket {
    if (!input || typeof input !== "object" || typeof input.uploadId !== "string" || !input.uploadId.trim()
        || typeof input.url !== "string" || !safeUploadUrl(input.url)
        || !input.headers || typeof input.headers !== "object" || Array.isArray(input.headers)
        || (input.expiresAt !== undefined && (!Number.isFinite(input.expiresAt) || input.expiresAt <= 0))) {
        throw new UploadIssue("INVALID_UPLOAD_TICKET", "无法获取有效的上传地址，稍后重试。");
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.headers)) {
        if (!name || /[\s:]/u.test(name) || typeof value !== "string" || /[\r\n]/u.test(value)) {
            throw new UploadIssue("INVALID_UPLOAD_TICKET", "上传地址的请求信息不完整，稍后重试。");
        }
        headers[name] = value;
    }
    if (input.duplicate !== undefined && (!input.duplicate || input.duplicate.kind !== "same-file"
        || (input.duplicate.name !== undefined && typeof input.duplicate.name !== "string"))) {
        throw new UploadIssue("INVALID_UPLOAD_TICKET", "无法识别重复文件提示，稍后重试。");
    }
    return {
        uploadId: input.uploadId, url: input.url, headers,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        ...(input.duplicate === undefined ? {} : { duplicate: { kind: "same-file", ...(input.duplicate.name === undefined ? {} : { name: input.duplicate.name }) } }),
    };
}

function expired(ticket: UploadTicket): boolean {
    return ticket.expiresAt !== undefined && ticket.expiresAt <= Date.now() / 1000;
}

function serviceMessage(status: number | undefined, stage: UploadStage): string {
    if (status === 401) return "登录已失效，重新登录后继续。";
    if (status === 403) return stage === "uploading" ? "上传被拒绝，重试或检查上传权限。" : "没有权限上传或确认此文件。";
    if (status === 404) return "上传记录已不可用，重新选择文件后上传。";
    if (status === 409) return "上传记录发生变化，稍后重试。";
    if (status === 413) return "文件超过服务允许的大小。";
    if (status === 429) return "操作过于频繁，稍后重试。";
    if (status !== undefined && status >= 500) return "上传服务暂时不可用，稍后重试。";
    if (stage === "preparing") return "未能准备上传，检查网络后重试。";
    if (stage === "confirming") return "文件已传输，但确认未完成。重试确认即可。";
    return "文件上传失败，检查网络后重试。";
}

function failureFrom(error: unknown, stage: UploadStage): UploadFailure {
    if (error instanceof UploadIssue) return { stage, code: error.code, message: error.message, ...(error.status === undefined ? {} : { status: error.status }) };
    const detail = error && typeof error === "object" ? error as { status?: unknown; code?: unknown } : undefined;
    const status = typeof detail?.status === "number" && Number.isInteger(detail.status) ? detail.status : undefined;
    const code = typeof detail?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(detail.code) ? detail.code : "UPLOAD_FAILED";
    return { stage, code, message: serviceMessage(status, stage), ...(status === undefined ? {} : { status }) };
}

function putFile(file: File, ticket: UploadTicket, signal: AbortSignal, timeout: number, onProgress: (loaded: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(abortError()); return; }
        const xhr = new XMLHttpRequest();
        let settled = false;
        const cleanup = () => {
            signal.removeEventListener("abort", abort);
            xhr.upload.onprogress = null;
            xhr.onload = null;
            xhr.onerror = null;
            xhr.onabort = null;
            xhr.ontimeout = null;
        };
        const finish = (error?: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error === undefined) resolve();
            else reject(error);
        };
        const abort = () => {
            finish(abortError());
            xhr.abort();
        };
        xhr.upload.onprogress = event => {
            if (!settled && Number.isFinite(event.loaded)) onProgress(Math.max(0, Math.min(file.size, event.loaded)));
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) finish();
            else finish(new UploadIssue("UPLOAD_HTTP_ERROR", serviceMessage(xhr.status, "uploading"), xhr.status));
        };
        xhr.onerror = () => { finish(new UploadIssue("NETWORK_ERROR", "文件传输中断，检查网络后重试。")); };
        xhr.ontimeout = () => { finish(new UploadIssue("UPLOAD_TIMEOUT", "文件上传超时，检查网络后重试。")); };
        xhr.onabort = () => { finish(new UploadIssue("UPLOAD_ABORTED", "文件传输已中断，可以重试。")); };
        signal.addEventListener("abort", abort, { once: true });
        try {
            xhr.open("PUT", ticket.url, true);
            xhr.withCredentials = false;
            xhr.timeout = timeout;
            for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);
            if (signal.aborted) abort();
            else xhr.send(file);
        } catch {
            finish(new UploadIssue("UPLOAD_START_FAILED", "无法开始文件传输，重新获取上传地址后重试。"));
            xhr.abort();
        }
    });
}

const busyStatuses = new Set(["validating", "preparing", "awaiting-duplicate", "uploading", "confirming"]);

/** One file per controller. Failures are reported in state; operations resolve after handling them. */
export function createUploadController<T>({ backend, maxBytes, timeoutMs = 120_000 }: UploadOptions<T>): UploadController<T> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive safe integer");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 0xffffffff) throw new RangeError("timeoutMs must fit an unsigned 32-bit integer");
    let state: Readonly<UploadSnapshot<T>> = Object.freeze({ status: "idle", file: null, loaded: 0, total: 0 });
    const listeners = new Set<(value: Readonly<UploadSnapshot<T>>) => void>();
    let generation = 0;
    let active: AbortController | undefined;
    let ticket: UploadTicket | undefined;
    let uploaded = false;
    let duplicateAccepted = false;
    let disposed = false;

    function publish(next: UploadSnapshot<T>) {
        state = Object.freeze({ ...next, ...(next.failure ? { failure: Object.freeze({ ...next.failure }) } : {}) });
        for (const listener of listeners) listener(state);
    }

    function invalidate() {
        generation += 1;
        const previous = active;
        active = undefined;
        previous?.abort();
    }

    async function launch(file: File, mode: "prepare" | "confirm" | "continue") {
        invalidate();
        const token = generation;
        const abort = new AbortController();
        active = abort;
        let stage: UploadStage = mode === "confirm" ? "confirming" : "validating";
        const current = () => !disposed && token === generation && !abort.signal.aborted;
        const ensureCurrent = () => { if (!current()) throw abortError(); };

        async function prepareFresh(): Promise<UploadTicket> {
            stage = "preparing";
            // A bounded refresh handles an already-expired ticket without an endless loop.
            for (let attempt = 0; attempt < 2; attempt += 1) {
                publish({ status: "preparing", file, loaded: 0, total: file.size });
                ensureCurrent();
                const validation = validateFile(file, maxBytes);
                if (!validation.ok) throw new UploadIssue(validation.code, validation.message);
                const result = await abortable(backend.prepare({ name: file.name, size: file.size, type: validation.mime }, abort.signal), abort.signal);
                ensureCurrent();
                const prepared = normalizedTicket(result);
                if (!expired(prepared)) return prepared;
            }
            throw new UploadIssue("TICKET_EXPIRED", "上传地址已过期，重试以获取新地址。");
        }

        try {
            if (mode === "prepare") {
                uploaded = false;
                ticket = undefined;
                publish({ status: "validating", file, loaded: 0, total: file.size });
                ensureCurrent();
                const validation = validateFile(file, maxBytes);
                if (!validation.ok) throw new UploadIssue(validation.code, validation.message);
                const prepared = await prepareFresh();
                ensureCurrent();
                ticket = prepared;
            } else if (!ticket) {
                throw new UploadIssue("MISSING_UPLOAD_TICKET", "上传记录已不可用，重新选择文件后上传。");
            }
            ensureCurrent();

            if (mode !== "confirm") {
                if (expired(ticket!)) {
                    const prepared = await prepareFresh();
                    ensureCurrent();
                    ticket = prepared;
                }
                ensureCurrent();
                if (ticket!.duplicate && !duplicateAccepted) {
                    publish({ status: "awaiting-duplicate", file, loaded: 0, total: file.size, duplicate: ticket!.duplicate });
                    return;
                }
                stage = "uploading";
                publish({ status: "uploading", file, loaded: 0, total: file.size });
                ensureCurrent();
                await putFile(file, ticket!, abort.signal, timeoutMs, loaded => {
                    if (current()) publish({ status: "uploading", file, loaded: Math.max(state.loaded, loaded), total: file.size });
                });
                ensureCurrent();
                uploaded = true;
            }

            stage = "confirming";
            publish({ status: "confirming", file, loaded: file.size, total: file.size });
            ensureCurrent();
            const result = await abortable(backend.confirm(ticket!.uploadId, abort.signal), abort.signal);
            ensureCurrent();
            publish({ status: "done", file, loaded: file.size, total: file.size, result });
        } catch (error) {
            if (current()) publish({ status: "failed", file, loaded: state.loaded, total: file.size, failure: failureFrom(error, stage) });
        } finally {
            if (token === generation) active = undefined;
        }
    }

    return {
        get state() { return state; },
        get busy() { return !disposed && busyStatuses.has(state.status); },
        subscribe(listener) {
            if (!disposed) listeners.add(listener);
            listener(state);
            return () => { listeners.delete(listener); };
        },
        async start(file) {
            if (disposed || busyStatuses.has(state.status)) return;
            duplicateAccepted = false;
            await launch(file, "prepare");
        },
        async retry() {
            if (disposed || !state.file || (state.status !== "failed" && state.status !== "cancelled")) return;
            await launch(state.file, uploaded && ticket ? "confirm" : "prepare");
        },
        async continueDuplicate() {
            if (disposed || state.status !== "awaiting-duplicate" || !state.file) return;
            duplicateAccepted = true;
            await launch(state.file, "continue");
        },
        cancel() {
            if (disposed || !busyStatuses.has(state.status)) return;
            invalidate();
            publish({ status: "cancelled", file: state.file, loaded: state.loaded, total: state.total });
        },
        reset() {
            if (disposed) return;
            invalidate();
            ticket = undefined;
            uploaded = false;
            duplicateAccepted = false;
            publish({ status: "idle", file: null, loaded: 0, total: 0 });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            invalidate();
            if (busyStatuses.has(state.status)) state = Object.freeze({ status: "cancelled", file: state.file, loaded: state.loaded, total: state.total });
            ticket = undefined;
            listeners.clear();
        },
    };
}