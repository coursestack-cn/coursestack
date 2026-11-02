import { SvelteMap } from "svelte/reactivity";

type AvatarUpdate = { url: string | null; version: number };
const updates = new SvelteMap<string, AvatarUpdate>();
let version = 0;

// Override stale author DTOs as well as already-mounted images after a successful mutation.
export function updateAvatar(id: string, url: string | null): void {
    updates.set(id, { url, version: ++version });
}

export function avatarSource(id: string | undefined, fallback: string | undefined): string | undefined {
    const update = id ? updates.get(id) : undefined;
    if (!update) return fallback;
    return update.url ? `${update.url}${update.url.includes("?") ? "&" : "?"}v=${update.version}` : undefined;
}