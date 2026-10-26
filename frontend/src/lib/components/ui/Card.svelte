<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLElement>, "children"> & {
        padding?: "none" | "md" | "lg";
        href?: string;
        children?: Snippet;
    };
</script>

<script lang="ts">
    import Link from "$lib/components/ui/Link.svelte";

    let { padding = "md", href, children, class: className = "", ...rest }: Props = $props();
    const classes = $derived(`cs-card padding-${padding} ${className}`);
</script>

{#if href !== undefined}<Link {...rest} class={classes} {href}>{@render children?.()}</Link>
{:else}<div {...rest} class={classes}>{@render children?.()}</div>{/if}

<style>
    :global(.cs-card) { display: block; min-width: 0; max-width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text); overflow-wrap: anywhere; }
    :global(.cs-card.padding-md) { padding: var(--space-4); }
    :global(.cs-card.padding-lg) { padding: var(--space-6); }
    :global(a.cs-card) { transition: border-color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out); text-decoration: none; }
    :global(a.cs-card:hover) { border-color: var(--color-border-strong); color: var(--color-text); background: var(--color-surface-sunken); text-decoration: none; }
    :global(a.cs-card:active) { background: var(--color-accent-soft); }
    :global(a.cs-card:focus-visible) { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
</style>