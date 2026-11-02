<script module lang="ts">
    import { untrack } from "svelte";

    let pending = $state(0);

    // Register during component initialization; each active source releases itself on cleanup.
    export function trackPageLoading(active: () => boolean) {
        $effect(() => {
            if (!active()) return;
            untrack(() => { pending++; });
            return () => { untrack(() => { pending--; }); };
        });
    }
</script>

{#if pending > 0}
    <div class="page-loading" role="progressbar" aria-label="正在加载内容"><span></span></div>
{/if}

<style>
    .page-loading { position: fixed; inset-inline: 0; top: 0; z-index: var(--z-toast); height: var(--space-1); overflow: hidden; background: var(--color-accent-soft); pointer-events: none; }
    .page-loading span { display: block; width: 35%; height: 100%; background: var(--color-accent); animation: loading calc(var(--duration-base) * 6) var(--ease-out) infinite alternate; }
    @keyframes loading { to { transform: translateX(185%); } }
    @media (prefers-reduced-motion: reduce) { .page-loading span { animation: none; width: 100%; } }
</style>