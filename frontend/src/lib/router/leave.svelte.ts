import { onDestroy } from "svelte";

const guards = new Map<() => boolean, boolean>();
let prompt: (() => Promise<boolean>) | undefined;
let confirming = false;

// Return false when leaving would discard work. Cleanup follows the page's lifecycle.
export function onBeforeLeave(callback: () => boolean, options: { samePage?: boolean } = {}): () => void {
    guards.set(callback, options.samePage ?? false);
    const remove = () => { guards.delete(callback); };
    onDestroy(remove);
    return remove;
}

export function hasUnsavedChanges(samePageOnly = false): boolean {
    return [...guards].some(([guard, samePage]) => (!samePageOnly || samePage) && !guard());
}

export function registerLeavePrompt(callback: () => Promise<boolean>): () => void {
    prompt = callback;
    return () => { if (prompt === callback) prompt = undefined; };
}

export async function confirmLeave(samePageOnly = false): Promise<boolean> {
    if (confirming) return false;
    if (!hasUnsavedChanges(samePageOnly)) return true;
    if (!prompt) return false;
    confirming = true;
    try { return await prompt(); } finally { confirming = false; }
}