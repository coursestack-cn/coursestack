<script module lang="ts">
    import type { HTMLTimeAttributes } from "svelte/elements";

    export type Props = Omit<HTMLTimeAttributes, "children" | "datetime" | "title"> & {
        timestamp: number;
    };
</script>

<script lang="ts">
    import { formatRelativeTime } from "$lib/content/relative-time";
    import { useRelativeClock } from "$lib/content/relative-time.svelte.js";

    let { timestamp, class: className = "", ...rest }: Props = $props();
    const clock = useRelativeClock();
    const formatted = $derived(formatRelativeTime(timestamp, clock.now));
</script>

<time {...rest} class={`relative-time ${className}`} datetime={formatted.datetime} title={formatted.title}>{formatted.label}</time>

<style>
    .relative-time { color: var(--color-text-secondary); font-size: inherit; overflow-wrap: anywhere; }
</style>