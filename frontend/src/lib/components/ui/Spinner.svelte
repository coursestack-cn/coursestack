<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & { label?: string };
</script>

<script lang="ts">
    import { LoaderCircle } from "@lucide/svelte";

    let { label = "正在加载", class: className = "", ...rest }: Props = $props();
</script>

<span {...rest} class={`spinner ${className}`} role="status" aria-label={label}>
    <LoaderCircle size="1em" aria-hidden="true" />
</span>

<style>
    .spinner { display: inline-flex; flex-shrink: 0; vertical-align: middle; }
    .spinner :global(svg) { animation: spin calc(var(--duration-base) * 4) linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner :global(svg) { animation: none; } }
</style>