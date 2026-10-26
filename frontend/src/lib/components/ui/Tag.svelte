<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLElement>, "children"> & {
        href?: string;
        disabled?: boolean;
        onremove?: () => void;
        removeLabel?: string;
        children?: Snippet;
    };
</script>

<script lang="ts">
    import { X } from "@lucide/svelte";
    import Link from "$lib/components/ui/Link.svelte";

    let { href, disabled = false, onclick, onremove, removeLabel = "移除标签", children, class: className = "", ...rest }: Props = $props();
</script>

<span {...rest} class={`tag ${className}`} class:disabled>
    {#if href !== undefined}
        <Link class="cs-tag-action" href={disabled ? undefined : href} role="link" aria-disabled={disabled || undefined}
            tabindex={disabled ? -1 : 0} onclick={(event) => { if (disabled) event.preventDefault(); else onclick?.(event); }}>
            {@render children?.()}
        </Link>
    {:else if onclick}
        <button class="cs-tag-action" type="button" {disabled} {onclick}>{@render children?.()}</button>
    {:else}<span class="text">{@render children?.()}</span>{/if}
    {#if onremove}<button class="remove" type="button" {disabled} aria-label={removeLabel} onclick={onremove}><X size="1em" /></button>{/if}
</span>

<style>
    .tag { display: inline-flex; align-items: center; max-width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-sunken); color: var(--color-text-secondary); font-size: var(--font-size-xs); line-height: var(--line-height-tight); }
    .text, :global(.cs-tag-action) { min-width: 0; padding: var(--space-1) var(--space-2); overflow-wrap: anywhere; }
    :global(.cs-tag-action), .remove { border: 0; border-radius: var(--radius-sm); background: none; color: inherit; font: inherit; cursor: pointer; text-decoration: none; }
    :global(.cs-tag-action:hover:not(:disabled):not([aria-disabled="true"])), .remove:hover:not(:disabled) { background: var(--color-border); color: var(--color-text); text-decoration: none; }
    :global(.cs-tag-action:active:not(:disabled):not([aria-disabled="true"])), .remove:active:not(:disabled) { background: var(--color-border-strong); }
    :global(.cs-tag-action:focus-visible), .remove:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    .remove { display: flex; flex-shrink: 0; padding: var(--space-1); margin-inline-end: var(--space-1); }
    .disabled { opacity: 0.5; }
    :global(.cs-tag-action:disabled), :global(.cs-tag-action[aria-disabled="true"]), .remove:disabled { cursor: not-allowed; }
</style>