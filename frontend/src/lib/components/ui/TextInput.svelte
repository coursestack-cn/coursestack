<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLInputAttributes } from "svelte/elements";

    export type Props = Omit<HTMLInputAttributes, "children" | "type" | "value"> & {
        type?: "text" | "password" | "search" | "email" | "number";
        value?: string | number;
        invalid?: boolean;
        icon?: Snippet;
        clearable?: boolean;
    };
</script>

<script lang="ts">
    import { X } from "@lucide/svelte";
    import Button from "$lib/components/ui/Button.svelte";

    let { value = $bindable(""), type = "text", invalid = false, icon, clearable = false,
        class: className = "", oninput, ...rest }: Props = $props();
    let input: HTMLInputElement;
</script>

<div class={`input-wrap ${className}`} class:has-icon={Boolean(icon)} class:clearable>
    {#if icon}<span class="icon" aria-hidden="true">{@render icon()}</span>{/if}
    <input {...rest} bind:this={input} {type} {value} aria-invalid={invalid || rest["aria-invalid"]} oninput={(event) => {
        value = type === "number" && event.currentTarget.value !== "" ? event.currentTarget.valueAsNumber : event.currentTarget.value;
        oninput?.(event);
    }} />
    {#if clearable && value !== ""}
        <span class="clear"><Button iconOnly size="sm" variant="ghost" aria-label="清空内容" disabled={Boolean(rest.disabled || rest.readonly)}
            onclick={() => {
                input.value = "";
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.focus();
            }}><X size="1em" /></Button></span>
    {/if}
</div>

<style>
    .input-wrap { position: relative; min-width: 0; width: 100%; }
    input { width: 100%; min-width: 0; min-height: var(--space-10); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font-size: var(--font-size-md); line-height: var(--line-height-tight); transition: border-color var(--duration-fast) var(--ease-out); }
    input:hover:not(:disabled) { border-color: var(--color-text-secondary); }
    input:active:not(:disabled) { border-color: var(--color-accent); }
    input:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    input[aria-invalid="true"] { border-color: var(--color-danger); }
    input:disabled { opacity: 0.5; cursor: not-allowed; background: var(--color-surface-sunken); }
    input::placeholder { color: var(--color-text-muted); }
    input::-webkit-search-cancel-button { appearance: none; }
    .has-icon input { padding-inline-start: var(--space-10); }
    .clearable input { padding-inline-end: var(--space-10); }
    .icon { position: absolute; inset-inline-start: var(--space-3); top: 50%; transform: translateY(-50%); display: flex; color: var(--color-text-secondary); pointer-events: none; font-size: var(--font-size-md); }
    .icon :global(svg) { width: 1em; height: 1em; }
    .clear { display: flex; position: absolute; inset-inline-end: var(--space-1); top: 50%; transform: translateY(-50%); }
</style>