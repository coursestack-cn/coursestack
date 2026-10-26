import { api, onUnauthorized, toApiError, type ApiError } from "$lib/api/client";
import { toast } from "$lib/components/ui/toast.svelte.js";

export type Role = "student" | "teacher" | "admin";
export type User = { id: string; publicName: string; roles: Role[] };
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
    async logout(): Promise<void> {
        const requestRevision = ++revision;
        await api.post("/api/auth/logout");
        if (requestRevision !== revision) return;
        user = null;
        error = null;
        status = "anonymous";
    },
    hasRole: (role: Role) => user?.roles.includes(role) ?? false
};