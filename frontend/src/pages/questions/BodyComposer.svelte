<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { api } from "$lib/api/client";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte.js";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";
    import RichTextEditor from "$lib/rich-text/RichTextEditor.svelte";
    import { isEmptyDoc, validateDoc, type RichTextDoc } from "$lib/rich-text/index";
    import Field from "$lib/components/ui/Field.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import { emptyDoc, publisher } from "./data";

    let { label, path, initial, context = {}, compact = false, guardSamePage = false, oncomplete, oncancel, onstatechange }: {
        label: string; path: string; initial?: RichTextDoc | null; context?: Record<string, string>;
        compact?: boolean; guardSamePage?: boolean; oncomplete: (id?: string) => void; oncancel?: () => void;
        onstatechange?: (state: { dirty: boolean; pending: boolean }) => void;
    } = $props();
    const editing = untrack(() => initial !== undefined);
    const original = untrack(() => JSON.stringify(initial ?? emptyDoc()));
    let body = $state<RichTextDoc | null>(JSON.parse(original));
    let valid = $state(false);
    let pending = $state(false);
    let error = $state("");
    let editorKey = $state(0);
    let saved = $state(false);
    let cancelling = $state(false);
    const dirty = $derived(!saved && (body === null || (editing ? JSON.stringify(body) !== original : !isEmptyDoc(body))));
    const request = publisher();
    const controller = new AbortController();
    onDestroy(() => controller.abort());
    onBeforeLeave(() => !dirty && !pending, { samePage: untrack(() => guardSamePage) });
    $effect(() => { const state = { dirty, pending }; untrack(() => onstatechange?.(state)); });

    async function submit() {
        if (pending || !session.user || !valid || !body || !validateDoc(body).ok || isEmptyDoc(body)) return;
        pending = true;
        error = "";
        try {
            const result = editing ? await api.patch<{ id: string }>(path, { body }, { signal: controller.signal })
                : await request.post<{ id: string }>(path, { ...context, body }, session.user.id, controller.signal);
            if (controller.signal.aborted) return;
            saved = true;
            pending = false;
            if (!editing) { body = emptyDoc(); request.reset(); editorKey++; saved = false; }
            oncomplete(result.id);
        } catch (cause) {
            if (!isAborted(cause)) error = userMessage(cause, { CONTENT_UNAVAILABLE: "内容已不可用，刷新页面后重试。" });
        } finally { pending = false; }
    }

    function discard() {
        if (pending) return;
        if (dirty) {
            // Clearing is explicit; navigation uses the shared leave guard.
            body = editing ? JSON.parse(original) as RichTextDoc : emptyDoc();
            editorKey++;
        }
        oncancel?.();
    }
    function cancel() { if (dirty) cancelling = true; else discard(); }
</script>

<form class="composer" onsubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={pending || undefined}>
    <Field {label} error={error || undefined}>
        {#snippet children(control)}
            {#key editorKey}<RichTextEditor {...control} bind:value={body} toolbar={compact ? "compact" : "full"}
                disabled={pending} onstatechange={(state) => { valid = state.valid; }} onsubmit={() => { void submit(); }} />{/key}
        {/snippet}
    </Field>
    <div class="composer-actions">
        <Button type="submit" variant="primary" loading={pending} disabled={!valid || !body || isEmptyDoc(body)}>{editing ? "保存修改" : label}</Button>
        {#if oncancel}<Button disabled={pending} onclick={cancel}>取消</Button>{/if}
    </div>
</form>

<ConfirmDialog bind:open={cancelling} title="放弃修改？" description="尚未提交的内容将丢失。" confirmLabel="放弃修改" onconfirm={discard} />

<style>
    .composer { display: grid; gap: var(--space-3); min-width: 0; }
    .composer-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
</style>