<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLElement>, "children">;
</script>

<script lang="ts">
    import Toast from "$lib/components/ui/Toast.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";

    let { class: className = "", ...rest }: Props = $props();
</script>

<aside {...rest} class={`toaster ${className}`} class:populated={toast.messages.length > 0} aria-label={rest["aria-label"] ?? "操作提示"}>
    {#each toast.messages as message (message.id)}
        <Toast tone={message.tone} message={message.message} action={message.action} onclose={() => toast.dismiss(message.id)} />
    {/each}
</aside>

<style>
    /* Leave room for shadows before the scroll clip; the other edges meet the viewport. */
    .toaster { --toast-width: calc(var(--space-12) * 8); position: fixed; inset-inline-end: 0; bottom: 0; z-index: var(--z-toast); display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-3); width: min(calc(var(--toast-width) + var(--space-12) + var(--space-4)), 100%); max-height: 100dvh; padding: var(--space-12) var(--space-4) var(--space-4); padding-inline-start: clamp(var(--space-4), calc(100% - var(--toast-width) - var(--space-4)), var(--space-12)); overflow-y: auto; pointer-events: none; }
    .toaster.populated { pointer-events: auto; }
    .toaster :global(.toast) { width: 100%; flex-shrink: 0; }
</style>