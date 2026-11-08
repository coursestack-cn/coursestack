import { ApiError } from "$lib/api/client";

export type MessageOverrides = { [codeOrStatus: string]: string | undefined; default?: string };

const fallback = "操作未完成，稍后重试。";
const messages: Record<number, string> = {
    400: "提交的内容有误，检查后重试。",
    401: "登录已失效，重新登录后继续。",
    403: "没有权限进行此操作。",
    404: "内容不存在或已被删除。",
    409: "内容已被修改，刷新后重试。",
    413: "内容过大，缩短后重试。",
    429: "操作太频繁，稍后再试。"
};

export function isAborted(error: unknown): boolean {
    return (error instanceof ApiError && error.code === "ABORTED")
        || (error instanceof DOMException && error.name === "AbortError");
}

/**
 * Once publication starts, a network error cannot tell us whether the server committed the post.
 * Retrying the same body in this editor reuses its idempotency key.
 */
export function publishMessage(error: unknown, sent: boolean, overrides: MessageOverrides = {}): string {
    if (sent && error instanceof ApiError && error.code === "NETWORK_ERROR") {
        return "网络中断，内容可能已经发布。在当前编辑框原样重试不会重复发布。如需修改，先在新标签页确认是否已发布。";
    }
    return userMessage(error, overrides);
}

// Backend diagnostics stay in ApiError.message and the client's console warning.
// Never interpolate error.message into user-facing text.
export function userMessage(error: unknown, overrides: MessageOverrides = {}): string {
    if (isAborted(error)) return "";
    if (!(error instanceof ApiError)) return overrides.default ?? fallback;
    if (error.code === "ACCOUNT_CHANGED") return "其他标签页更换了登录账号，操作未执行。";
    const override = (Object.hasOwn(overrides, error.code) ? overrides[error.code] : undefined)
        ?? (Object.hasOwn(overrides, error.status) ? overrides[error.status] : undefined);
    if (typeof override === "string") return override;
    if (error.status === 0 && error.code === "NETWORK_ERROR") return "无法连接服务器，检查网络后重试。";
    if (error.code === "BODY_IMAGE_TOO_LARGE") return "单张图片最大为 1 MiB。";
    if (error.code === "BODY_IMAGE_TYPE") return "图片文件格式不符，请选择 PNG、JPEG、GIF 或 WebP 图片。";
    if (error.code === "BODY_IMAGE_UNAVAILABLE" || error.code === "BODY_IMAGE_DUPLICATE") return "图片已失效或无法复制，请重新选择图片。";
    if (overrides.default !== undefined) return overrides.default;
    if (error.code === "INVALID_RESPONSE") return fallback;
    if (error.status >= 500 && error.status < 600) return "服务暂时不可用，稍后重试。";
    return messages[error.status] ?? fallback;
}