import { untrack } from "svelte";
import { api, guardWrites, onUnauthorized, toApiError, type ApiError } from "$lib/api/client";
import { toast } from "$lib/components/ui/toast.svelte.js";
import { updateAvatar } from "$lib/avatar/state.svelte.js";

export type Role = "student" | "teacher" | "admin";
export type User = { id: string; nickname: string | null; role: Role; mustChangePassword: boolean };
export type SessionStatus = "loading" | "authenticated" | "anonymous";

let status = $state<SessionStatus>("loading");
let user = $state.raw<User | null>(null);
let error = $state<ApiError | null>(null);
let accountSwitches = $state(0);
let revision = 0;
let started = false;
// Tells other tabs the shared cookie changed; each one then asks the server who it belongs to.
const channel = new BroadcastChannel("coursestack:session");

channel.onmessage = () => { void synchronize(); };
// A page restored from the back-forward cache missed messages sent while it was stored.
window.addEventListener("pageshow", (event) => { if (event.persisted) void synchronize(); });
guardWrites(() => untrack(() => user?.id), () => { void synchronize(); });

onUnauthorized(() => {
    const expired = status === "authenticated";
    if (status === "anonymous") return;
    revision++;
    user = null;
    error = null;
    status = "anonymous";
    if (expired) toast.info("登录已失效，重新登录后继续");
});

async function initialize(force = false): Promise<void> {
    if (started && !force) return;
    started = true;
    const requestRevision = ++revision;
    status = "loading";
    error = null;
    try {
        const result = await api.get<User>("/api/auth/me");
        if (requestRevision !== revision) return;
        user = result;
        status = "authenticated";
    } catch (cause) {
        if (requestRevision !== revision) return;
        const failure = toApiError(cause);
        user = null;
        if (failure.status === 401) status = "anonymous";
        else error = failure; // Keep identity unresolved until an explicit retry succeeds.
    }
}

// Unlike initialize, keeps the page mounted, so a tab whose account did not change loses nothing.
async function synchronize(): Promise<void> {
    if (status === "loading") return initialize(true);
    const requestRevision = ++revision;
    const previous = user?.id;
    try {
        const result = await api.get<User>("/api/auth/me");
        if (requestRevision !== revision) return;
        user = result;
        status = "authenticated";
        if (result.id === previous) return;
        if (previous) accountSwitches++;
        toast.info(`其他标签页更换了登录账号，当前为“${result.nickname ?? "未设置昵称"}”`);
    } catch {
        // onUnauthorized already handled a 401. After any other failure the
        // displayed account may be stale, but the server still refuses its writes.
    }
}

async function authenticate(path: string, body: unknown, signal?: AbortSignal): Promise<void> {
    const requestRevision = ++revision;
    const result = await api.post<User>(path, body, { signal });
    channel.postMessage(null);
    if (signal?.aborted || requestRevision !== revision) return;
    user = result;
    error = null;
    status = "authenticated";
}

export const session = {
    get status() { return status; },
    get user() { return user; },
    get error() { return error; },
    // Counts direct changes from one account to another in this tab; pages remount on each.
    get accountSwitches() { return accountSwitches; },
    initialize,
    retry: () => initialize(true),
    login: (schoolNumber: string, password: string, signal?: AbortSignal) =>
        authenticate("/api/auth/login", { schoolNumber, password }, signal),
    adminLogin: (password: string, signal?: AbortSignal) =>
        authenticate("/api/auth/admin/login", { password }, signal),
    async changeNickname(nickname: string | null, signal?: AbortSignal): Promise<string | null | undefined> {
        const requestRevision = revision;
        const accountId = user?.id;
        const result = await api.patch<Pick<User, "id" | "nickname">>("/api/me/profile", { nickname }, { signal });
        if (signal?.aborted || requestRevision !== revision || status !== "authenticated"
            || !user || user.id !== accountId || result.id !== accountId) return;
        user = { ...user, nickname: result.nickname };
        return result.nickname;
    },
    async changePassword(oldPassword: string, newPassword: string): Promise<void> {
        const requestRevision = ++revision;
        await api.post("/api/auth/password", { oldPassword, newPassword });
        channel.postMessage(null);
        if (requestRevision !== revision) return;
        user = null;
        error = null;
        status = "anonymous";
    },
    async changeAvatar(image: Blob | null): Promise<boolean> {
        const requestRevision = revision;
        const accountId = user?.id;
        type Result = { id: string; avatarUrl: string | null };
        const result = image
            ? await api.put<Result>("/api/me/avatar", undefined, { rawBody: image, headers: { "Content-Type": image.type } })
            : await api.delete<Result>("/api/me/avatar");
        if (requestRevision !== revision || status !== "authenticated"
            || !user || user.id !== accountId || result.id !== accountId) return false;
        updateAvatar(result.id, result.avatarUrl);
        return true;
    },
    async logout(): Promise<void> {
        const requestRevision = ++revision;
        await api.post("/api/auth/logout");
        channel.postMessage(null);
        if (requestRevision !== revision) return;
        user = null;
        error = null;
        status = "anonymous";
    },
    hasRole: (role: Role) => user?.role === role
};