<script module lang="ts">
    import type { Snippet } from "svelte";

    export type Props = { children: Snippet };
</script>

<script lang="ts">
    import Link from "$lib/components/ui/Link.svelte";
    import Toaster from "$lib/components/ui/Toaster.svelte";
    import AppHeader from "$lib/components/shell/AppHeader.svelte";

    let { children }: Props = $props();
    let main: HTMLElement;
</script>

<div class="app-shell">
    <Link href="#main" class="shell-skip-link" onclick={(event) => {
        event.preventDefault();
        main.focus();
        main.scrollIntoView({ block: "start" });
    }}>跳到主要内容</Link>
    <AppHeader />
    <main id="main" tabindex="-1" bind:this={main}>{@render children()}</main>
    <Toaster />
</div>

<style>
    .app-shell { min-height: 100dvh; display: flex; flex-direction: column; }
    main { flex: 1; min-width: 0; outline: none; }
    :global(.shell-skip-link) { position: fixed; inset-block-start: var(--space-2); inset-inline-start: var(--space-2); transform: translateY(calc(-100% - var(--space-4))); padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); background: var(--color-accent); color: var(--color-on-accent); z-index: var(--z-toast); }
    :global(.shell-skip-link:focus) { transform: translateY(0); }
</style>