<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
        name: string;
        src?: string;
        alt?: string;
        size?: "sm" | "md" | "lg";
    };
</script>

<script lang="ts">
    let { name, src, alt, size = "md", class: className = "", ...rest }: Props = $props();
    let failedSrc = $state<string>();
    const palette = $derived(Array.from(name).reduce((hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0, 0) % 5);
    const initial = $derived(Array.from(new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(name.trim()))[0]?.segment ?? "?");
</script>

<span {...rest} class={`avatar ${size} palette-${palette} ${className}`}>
    {#if src && src !== failedSrc}
        <img {src} alt={alt ?? name} onerror={() => { failedSrc = src; }} />
    {:else}<span role="img" aria-label={alt ?? name}>{initial}</span>{/if}
</span>

<style>
    .avatar { --avatar-bg: var(--color-surface-sunken); --avatar-text: var(--color-text-secondary); display: inline-flex; align-items: center; justify-content: center; width: var(--space-8); height: var(--space-8); flex-shrink: 0; overflow: hidden; border-radius: var(--radius-full); background: var(--avatar-bg); color: var(--avatar-text); font-size: var(--font-size-md); font-weight: var(--font-weight-bold); vertical-align: middle; }
    .sm { width: var(--space-6); height: var(--space-6); font-size: var(--font-size-xs); }
    .lg { width: var(--space-12); height: var(--space-12); font-size: var(--font-size-xl); }
    .palette-1 { --avatar-bg: var(--color-accent-soft); --avatar-text: var(--color-accent-soft-text); }
    .palette-2 { --avatar-bg: var(--color-success-soft); --avatar-text: var(--color-success-soft-text); }
    .palette-3 { --avatar-bg: var(--color-warning-soft); --avatar-text: var(--color-warning-soft-text); }
    .palette-4 { --avatar-bg: var(--color-teacher-soft); --avatar-text: var(--color-teacher-soft-text); }
    img { width: 100%; height: 100%; object-fit: cover; }
</style>