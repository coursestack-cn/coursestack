<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children" | "id"> & {
        value?: string[];
        id?: string;
        labelId?: string;
        describedBy?: string;
        invalid?: boolean;
        disabled?: boolean;
        required?: boolean;
        placeholder?: string;
    };
</script>

<script lang="ts">
    import Tag from "$lib/components/ui/Tag.svelte";
    import { addTags, TAG_LIMITS, validateTags } from "$lib/content/tag-input";

    const generatedId = $props.id();
    let {
        value = $bindable([]), id = generatedId, labelId, describedBy,
        invalid = false, disabled = false, required = false,
        placeholder = "输入标签后按 Enter", class: className = "", ...rest
    }: Props = $props();
    let draft = $state("");
    let error = $state<string>();
    let announcement = $state("");
    let composing = false;
    let input: HTMLInputElement;
    const valueError = $derived(validateTags(value));
    const feedback = $derived(error ?? valueError);
    const helpId = $derived(`${id}-tag-help`);
    const errorId = $derived(`${id}-tag-error`);
    const descriptions = $derived([describedBy, helpId, feedback && errorId].filter(Boolean).join(" "));

    function commit(text = draft, tail = "") {
        if (disabled) return;
        const result = addTags(value, text);
        value = result.tags;
        draft = [result.remaining, tail].filter(Boolean).join("，");
        error = result.error;
        if (result.added > 0) announcement = `已添加 ${result.added} 个标签，共 ${value.length} 个。`;
    }

    function commitDelimited(text: string) {
        const lastComma = Math.max(text.lastIndexOf(","), text.lastIndexOf("，"));
        if (lastComma >= 0) commit(text.slice(0, lastComma), text.slice(lastComma + 1));
    }

    function remove(index: number) {
        if (disabled) return;
        const removed = value[index];
        value = value.filter((_, current) => current !== index);
        error = undefined;
        announcement = `已移除标签 ${removed}。`;
        input.focus();
    }

    function keydown(event: KeyboardEvent) {
        if (disabled || composing || event.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" || event.key === "," || event.key === "，") {
            event.preventDefault();
            commit();
        } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
            event.preventDefault();
            remove(value.length - 1);
        }
    }

    function paste(event: ClipboardEvent) {
        if (disabled || composing) return;
        const pasted = event.clipboardData?.getData("text/plain");
        if (!pasted || !/[,，]/u.test(pasted)) return;
        event.preventDefault();
        const start = input.selectionStart ?? draft.length;
        const end = input.selectionEnd ?? draft.length;
        commit(draft.slice(0, start) + pasted + draft.slice(end));
    }
</script>

<div {...rest} class={`tag-input ${className}`} class:disabled>
    <div class="control" class:invalid={invalid || Boolean(feedback)}>
        {#if value.length > 0}
            <ul class="tags" aria-label="已添加的标签">
                {#each value as tag, index}
                    <li><Tag {disabled} onremove={() => remove(index)} removeLabel={`移除标签 ${tag}`}>{tag}</Tag></li>
                {/each}
            </ul>
        {/if}
        <input bind:this={input} {id} value={draft} {disabled} {placeholder}
            required={required && value.length === 0} autocomplete="off"
            aria-label={labelId ? undefined : (rest["aria-label"] ?? "标签")}
            aria-labelledby={labelId} aria-describedby={descriptions}
            aria-invalid={invalid || Boolean(feedback) || undefined}
            onkeydown={keydown} onpaste={paste}
            oninput={(event) => {
                draft = event.currentTarget.value;
                error = undefined;
                if (!composing && !(event instanceof InputEvent && event.isComposing)) commitDelimited(draft);
            }}
            oncompositionstart={() => { composing = true; }}
            oncompositionend={(event) => {
                composing = false;
                draft = event.currentTarget.value;
                commitDelimited(draft);
            }} />
    </div>
    <div class="hint-row"><p id={helpId} class="help">最多 {TAG_LIMITS.maxTags} 个，每个 1–{TAG_LIMITS.maxChars} 字；按 Enter 或逗号添加。</p><span class="count">{value.length}/{TAG_LIMITS.maxTags}</span></div>
    {#if feedback}<p id={errorId} class="error" role="alert">{feedback}</p>{/if}
    <span class="sr-only" role="status" aria-live="polite">{announcement}</span>
</div>

<style>
    .tag-input { display: grid; gap: var(--space-2); min-width: 0; }
    .control { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; min-height: var(--space-10); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); }
    .control:focus-within { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    .control.invalid { border-color: var(--color-danger); }
    .tags { display: contents; list-style: none; padding: 0; margin: 0; }
    .tags li { display: flex; min-width: 0; max-width: 100%; }
    input { flex: 1 1 calc(var(--space-10) * 3); width: 0; min-width: var(--space-10); max-width: 100%; border: 0; outline: none; padding: var(--space-1) 0; background: none; color: var(--color-text); font-size: var(--font-size-md); line-height: var(--line-height-tight); }
    input::placeholder { color: var(--color-text-muted); }
    .hint-row { display: flex; align-items: start; justify-content: space-between; gap: var(--space-2); }
    .help, .count, .error { color: var(--color-text-secondary); font-size: var(--font-size-sm); overflow-wrap: anywhere; }
    .count { flex-shrink: 0; }
    .error { color: var(--color-danger); }
    .disabled { opacity: 0.5; }
    .disabled .control { background: var(--color-surface-sunken); }
    input:disabled { cursor: not-allowed; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>