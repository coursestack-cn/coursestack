<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "teacher";
    export type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
        tone?: BadgeTone;
        appearance?: "soft" | "solid";
        icon?: Snippet;
        children?: Snippet;
    };
</script>

<script lang="ts">
    let { tone = "neutral", appearance = "soft", icon, children, class: className = "", ...rest }: Props = $props();
</script>

<span {...rest} class={`badge ${tone} ${appearance} ${className}`}>
    {#if icon}<span class="icon" aria-hidden="true">{@render icon()}</span>{/if}
    {@render children?.()}
</span>

<style>
    .badge { --badge-bg: var(--color-text-secondary); --badge-fg: var(--color-bg); --badge-soft: var(--color-surface-sunken); --badge-soft-text: var(--color-text-secondary); display: inline-flex; align-items: center; gap: var(--space-1); max-width: 100%; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); line-height: var(--line-height-tight); overflow-wrap: anywhere; background: var(--badge-soft); color: var(--badge-soft-text); }
    .solid { background: var(--badge-bg); color: var(--badge-fg); }
    .accent { --badge-bg: var(--color-accent); --badge-fg: var(--color-on-accent); --badge-soft: var(--color-accent-soft); --badge-soft-text: var(--color-accent-soft-text); }
    .success { --badge-bg: var(--color-success); --badge-fg: var(--color-on-success); --badge-soft: var(--color-success-soft); --badge-soft-text: var(--color-success-soft-text); }
    .warning { --badge-bg: var(--color-warning); --badge-fg: var(--color-on-warning); --badge-soft: var(--color-warning-soft); --badge-soft-text: var(--color-warning-soft-text); }
    .danger { --badge-bg: var(--color-danger); --badge-fg: var(--color-on-danger); --badge-soft: var(--color-danger-soft); --badge-soft-text: var(--color-danger-soft-text); }
    .teacher { --badge-bg: var(--color-teacher); --badge-fg: var(--color-on-teacher); --badge-soft: var(--color-teacher-soft); --badge-soft-text: var(--color-teacher-soft-text); }
    .icon { display: inline-flex; flex-shrink: 0; }
    .icon :global(svg) { width: 1em; height: 1em; }
</style>