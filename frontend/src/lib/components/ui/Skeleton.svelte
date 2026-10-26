<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        variant?: "text" | "block" | "circle";
        lines?: number;
        width?: string;
        height?: string;
    };
</script>

<script lang="ts">
    let { variant = "text", lines = 3, width, height, class: className = "", ...rest }: Props = $props();
    const lineCount = $derived(Math.max(1, Math.min(100, Math.floor(lines) || 1)));
</script>

<div {...rest} class={`skeleton ${variant} ${className}`} aria-hidden="true" style:width style:height>
    {#if variant === "text"}{#each Array(lineCount) as _, index}<span class:last={index === lineCount - 1 && lineCount > 1}></span>{/each}{/if}
</div>

<style>
    .skeleton { max-width: 100%; border-radius: var(--radius-md); animation: pulse calc(var(--duration-base) * 8) var(--ease-out) infinite alternate; }
    .text { display: grid; gap: var(--space-2); width: 100%; }
    .text span { display: block; height: 1em; background: var(--color-surface-sunken); border-radius: var(--radius-sm); }
    .text .last { width: 75%; }
    .block { width: 100%; height: calc(var(--space-12) * 2); background: var(--color-surface-sunken); }
    .circle { width: var(--space-12); height: var(--space-12); aspect-ratio: 1; border-radius: var(--radius-full); background: var(--color-surface-sunken); }
    @keyframes pulse { to { opacity: 0.4; } }
    @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
</style>