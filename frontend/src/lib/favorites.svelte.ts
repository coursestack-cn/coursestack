import { api, ApiError } from "$lib/api/client";
import { session } from "$lib/session.svelte";
import { urlId } from "$lib/router/ids";

export type FavoriteType = "course" | "material" | "question";
export type FavoriteTarget = { type: FavoriteType; id: string };
export type FavoriteStatus = FavoriteTarget & { favorited: boolean; createdAt: number | null };
export type FavoriteItem = { favoriteId: number; type: FavoriteType; targetId: string; createdAt: number;
    available: boolean; title: string | null; description: string | null; courseId: string; courseName: string };
export type FavoriteList = { viewer: string; items: FavoriteItem[]; page: number; pageSize: number; total: number;
    counts: Record<FavoriteType | "all", number>; courses: { id: string; name: string }[] };
export const favorites = $state({ revision: 0, pending: {} as Record<string, boolean> });
export const favoriteKey = (target: FavoriteTarget, viewer = session.user?.id) => JSON.stringify([viewer, target.type, target.id]);
export const favoriteHref = (type: FavoriteType, id: string) => type === "course" ? `/courses/${encodeURIComponent(id)}`
    : `/${type === "material" ? "materials" : "questions"}/${encodeURIComponent(urlId(id))}`;

type Pending = { target: FavoriteTarget; viewer: string; signal: AbortSignal;
    resolve: (value: FavoriteStatus & { viewer: string }) => void; reject: (error: unknown) => void };
let queue: Pending[] = [];
let channel: BroadcastChannel | undefined;
const changedAccount = () => new ApiError(409, "ACCOUNT_CHANGED", "登录账号已变化，请刷新后重试");
const aborted = () => new ApiError(0, "ABORTED", "请求已取消");

// All buttons mounted in the same render share bounded status requests.
async function flush() {
    const requests = queue; queue = [];
    const active = requests.filter(request => {
        if (request.signal.aborted) { request.reject(aborted()); return false; }
        if (request.viewer !== session.user?.id) { request.reject(changedAccount()); return false; }
        return true;
    });
    const unique = [...new Map(active.map(request => [favoriteKey(request.target, request.viewer), request.target])).values()];
    for (let offset = 0; offset < unique.length; offset += 50) {
        const targets = unique.slice(offset, offset + 50), keys = new Set(targets.map(t => JSON.stringify(t)));
        const batch = active.filter(request => keys.has(JSON.stringify(request.target)));
        try {
            const result = await api.get<{ viewer: string; items: FavoriteStatus[] }>(`/api/me/favorites/status?${new URLSearchParams({ targets: JSON.stringify(targets) })}`);
            for (const request of batch) {
                if (request.signal.aborted) request.reject(aborted());
                else if (result.viewer !== request.viewer || session.user?.id !== request.viewer) request.reject(changedAccount());
                else {
                    const item = result.items.find(item => item.type === request.target.type && item.id === request.target.id);
                    if (item) request.resolve({ ...item, viewer: result.viewer });
                    else request.reject(new ApiError(500, "INVALID_RESPONSE", "无法读取收藏状态"));
                }
            }
        } catch (error) { for (const request of batch) request.reject(error); }
    }
}
export function favoriteStatus(target: FavoriteTarget, signal: AbortSignal): Promise<FavoriteStatus & { viewer: string | undefined }> {
    const viewer = session.user?.id;
    if (!viewer) return Promise.resolve({ ...target, favorited: false, createdAt: null, viewer: undefined });
    return new Promise<FavoriteStatus & { viewer: string }>((resolve, reject) => {
        queue.push({ target, viewer, signal, resolve, reject });
        if (queue.length === 1) queueMicrotask(() => { void flush(); });
    });
}
export async function setFavorite(target: FavoriteTarget, desired: boolean, signal: AbortSignal) {
    const viewer = session.user?.id, key = favoriteKey(target, viewer);
    if (!viewer || favorites.pending[key]) return;
    favorites.pending[key] = true;
    try {
        const path = `/api/me/favorites/${target.type}/${encodeURIComponent(target.id)}`;
        if (desired) await api.put(path, {}, { signal }); else await api.delete(path, { signal });
        if (viewer !== session.user?.id) throw changedAccount();
    } finally {
        delete favorites.pending[key];
        if (viewer === session.user?.id) {
            favorites.revision++;
            channel?.postMessage({ viewer });
        }
    }
}
export function startFavoriteSync() {
    const refresh = () => { if (document.visibilityState === "visible") favorites.revision++; };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    try {
        channel = new BroadcastChannel("coursestack-favorites");
        channel.onmessage = event => { if (event.data?.viewer === session.user?.id) favorites.revision++; };
    } catch { /* Focus refresh still works without cross-tab messaging. */ }
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); channel?.close(); channel = undefined; };
}