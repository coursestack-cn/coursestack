<script module lang="ts">
    import type { HTMLInputAttributes } from "svelte/elements";

    export type Props = Omit<HTMLInputAttributes, "children" | "type" | "value" | "onsubmit"> & {
        value?: string;
        invalid?: boolean;
        onsubmit?: (value: string) => void;
        onclear?: () => void;
    };
</script>

<script lang="ts">
    import { Search, X } from "@lucide/svelte";
    import Button from "$lib/components/ui/Button.svelte";

    let { value = $bindable(""), invalid = false, disabled = false, readonly = false, onsubmit, onclear,
        onkeydown, class: className = "", ...rest }: Props = $props();
    let input: HTMLInputElement;
</script>

<div class={`search ${className}`}>
    <span class="icon" aria-hidden="true"><Search size="1em" /></span>
    <input {...rest} bind:this={input} bind:value type="search" {disabled} {readonly}
        aria-invalid={invalid || rest["aria-invalid"]} onkeydown={(event) => {
            onkeydown?.(event);
            if (!event.defaultPrevented && event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                onsubmit?.(value);
            }
        }} />
    {#if value}
        <span class="clear"><Button iconOnly size="sm" variant="ghost" aria-label="清除搜索" disabled={Boolean(disabled || readonly)}
            onclick={() => { value = ""; input.focus(); onclear?.(); }}><X size="1em" /></Button></span>
    {/if}
</div>

<style>
    .search { position: relative; min-width: 0; width: 100%; font-size: var(--font-size-md); }
    input { width: 100%; min-width: 0; min-height: var(--space-10); padding: var(--space-2) var(--space-10); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); transition: border-color var(--duration-fast) var(--ease-out); }
    input:hover:not(:disabled) { border-color: var(--color-text-secondary); }
    input:active:not(:disabled) { border-color: var(--color-accent); }
    input:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    input[aria-invalid="true"] { border-color: var(--color-danger); }
    input:disabled { opacity: 0.5; cursor: not-allowed; background: var(--color-surface-sunken); }
    input::placeholder { color: var(--color-text-muted); }
    input::-webkit-search-cancel-button { appearance: none; }
    .icon, .clear { display: flex; position: absolute; top: 50%; transform: translateY(-50%); }
    .icon { inset-inline-start: var(--space-3); color: var(--color-text-secondary); pointer-events: none; }
    .clear { inset-inline-end: var(--space-1); }
</style>