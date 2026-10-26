<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLInputAttributes } from "svelte/elements";

    export type Props = Omit<HTMLInputAttributes, "children" | "type" | "value"> & {
        type?: "text" | "password" | "search" | "email" | "number";
        value?: string | number;
        invalid?: boolean;
        icon?: Snippet;
    };
</script>

<script lang="ts">
    let { value = $bindable(""), type = "text", invalid = false, icon, class: className = "", oninput, ...rest }: Props = $props();
</script>

<div class={`input-wrap ${className}`} class:has-icon={Boolean(icon)}>
    {#if icon}<span class="icon" aria-hidden="true">{@render icon()}</span>{/if}
    <input {...rest} {type} {value} aria-invalid={invalid || rest["aria-invalid"]} oninput={(event) => {
        value = type === "number" && event.currentTarget.value !== "" ? event.currentTarget.valueAsNumber : event.currentTarget.value;
        oninput?.(event);
    }} />
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
    .has-icon input { padding-inline-start: var(--space-10); }
    .icon { position: absolute; inset-inline-start: var(--space-3); top: 50%; transform: translateY(-50%); display: flex; color: var(--color-text-secondary); pointer-events: none; font-size: var(--font-size-md); }
    .icon :global(svg) { width: 1em; height: 1em; }
</style>