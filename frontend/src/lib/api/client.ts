export class ApiError extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string) {
        super(message);
        this.name = "ApiError";
    }
}

export type RequestOptions = {
    signal?: AbortSignal;
    headers?: HeadersInit;
    rawBody?: BodyInit;
};

const unauthorizedListeners = new Set<() => void>();

export function onUnauthorized(listener: () => void): () => void {
    unauthorizedListeners.add(listener);
    return () => { unauthorizedListeners.delete(listener); };
}

export function toApiError(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (error instanceof DOMException && error.name === "AbortError") {
        return new ApiError(0, "ABORTED", "请求已取消。");
    }
    return new ApiError(0, "NETWORK_ERROR", "无法连接服务器，检查网络后重试。");
}

async function send<T>(method: string, path: string, body: unknown, options: RequestOptions): Promise<T> {
    if (!path.startsWith("/api/") || path.includes("\\") || /[\r\n\t]/.test(path)
        || !new URL(path, "https://coursestack.invalid").pathname.startsWith("/api/")) {
        throw new ApiError(0, "INVALID_PATH", "接口地址必须位于 /api/ 下。");
    }
    if (body !== undefined && options.rawBody !== undefined) {
        throw new ApiError(0, "INVALID_BODY", "不能同时发送 JSON 和原始请求体。");
    }

    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (body !== undefined) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
        response = await fetch(path, {
            method,
            headers,
            credentials: "same-origin",
            signal: options.signal,
            body: body === undefined ? options.rawBody : JSON.stringify(body)
        });
    } catch (error) {
        if (options.signal?.aborted) throw new ApiError(0, "ABORTED", "请求已取消。");
        throw toApiError(error);
    }

    if (response.status === 401) unauthorizedListeners.forEach((listener) => listener());
    if (response.status === 204) return undefined as T;

    let text: string;
    try {
        text = await response.text();
    } catch (error) {
        if (options.signal?.aborted) throw new ApiError(0, "ABORTED", "请求已取消。");
        throw toApiError(error);
    }
    if (response.ok && text.trim() === "") return undefined as T;

    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new ApiError(response.status, "INVALID_RESPONSE", "服务器返回了无法识别的内容，请稍后重试。");
    }

    if (!response.ok) {
        const detail = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
        if (detail && typeof detail === "object" && "code" in detail && "message" in detail
            && typeof detail.code === "string" && typeof detail.message === "string") {
            throw new ApiError(response.status, detail.code, detail.message);
        }
        throw new ApiError(response.status, "HTTP_ERROR", "请求未能完成，请稍后重试。");
    }

    if (!payload || typeof payload !== "object" || !("data" in payload)) {
        throw new ApiError(response.status, "INVALID_RESPONSE", "服务器返回的数据格式不正确，请稍后重试。");
    }
    return payload.data as T;
}

async function request<T>(method: string, path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    try {
        return await send<T>(method, path, body, options);
    } catch (cause) {
        const error = toApiError(cause);
        if (error.code !== "ABORTED") {
            console.warn("API 请求失败", { status: error.status, code: error.code, message: error.message });
        }
        throw error;
    }
}

export const api = {
    get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body, options),
    put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PUT", path, body, options),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PATCH", path, body, options),
    delete: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("DELETE", path, body, options)
};