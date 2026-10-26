import { onDestroy } from "svelte";

const guards = new Set<() => boolean>();
let prompt: (() => Promise<boolean>) | undefined;
let confirming = false;

// Return false when leaving would discard work. Cleanup follows the page's lifecycle.
export function onBeforeLeave(callback: () => boolean): () => void {
    guards.add(callback);
    const remove = () => { guards.delete(callback); };
    onDestroy(remove);
    return remove;
}

export function hasUnsavedChanges(): boolean {
    return [...guards].some((guard) => !guard());
}

export function registerLeavePrompt(callback: () => Promise<boolean>): () => void {
    prompt = callback;
    return () => { if (prompt === callback) prompt = undefined; };
}

export async function confirmLeave(): Promise<boolean> {
    if (confirming) return false;
    if (!hasUnsavedChanges()) return true;
    if (!prompt) return false;
    confirming = true;
    try { return await prompt(); } finally { confirming = false; }
}