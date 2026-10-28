import { api, onUnauthorized, toApiError, type ApiError } from "$lib/api/client";
import { toast } from "$lib/components/ui/toast.svelte.js";

export type Role = "student" | "teacher" | "admin";
export type User = { id: string; nickname: string | null; role: Role; mustChangePassword: boolean };
export type SessionStatus = "loading" | "authenticated" | "anonymous";

let status = $state<SessionStatus>("loading");
let user = $state.raw<User | null>(null);
let error = $state<ApiError | null>(null);
let revision = 0;
let started = false;

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

async function authenticate(path: string, body: unknown, signal?: AbortSignal): Promise<void> {
    const requestRevision = ++revision;
    const result = await api.post<User>(path, body, { signal });
    if (signal?.aborted || requestRevision !== revision) return;
    user = result;
    error = null;
    status = "authenticated";
}

export const session = {
    get status() { return status; },
    get user() { return user; },
    get error() { return error; },
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
        if (requestRevision !== revision) return;
        user = null;
        error = null;
        status = "anonymous";
    },
    async logout(): Promise<void> {
        const requestRevision = ++revision;
        await api.post("/api/auth/logout");
        if (requestRevision !== revision) return;
        user = null;
        error = null;
        status = "anonymous";
    },
    hasRole: (role: Role) => user?.role === role
};