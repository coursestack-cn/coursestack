<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { ApiError } from "$lib/api/client";
    import type { ResourceStatus } from "$lib/api/resource.svelte.js";

    export type Props = {
        status: ResourceStatus;
        error?: ApiError | null;
        refreshing?: boolean;
        reload?: () => void | Promise<void>;
        children?: Snippet;
    };
</script>

<script lang="ts">
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import NotFoundContent from "$lib/components/shell/NotFoundContent.svelte";
    import { router } from "$lib/router/router.svelte.js";
    import { loginHref } from "$lib/router/urls";
    import { isAborted, userMessage } from "$lib/api/errors";

    let { status, error = null, refreshing = false, reload, children }: Props = $props();
    let showLoading = $state(false);

    $effect(() => {
        showLoading = false;
        if (status !== "loading") return;
        const timer = window.setTimeout(() => { showLoading = true; }, 200);
        return () => window.clearTimeout(timer);
    });
</script>

{#if status === "loading"}
    <div class="loading-space" aria-busy="true">
        {#if showLoading}<StateBlock kind="loading" />{/if}
    </div>
{:else if status === "error" && !isAborted(error)}
    {#if error?.status === 401}
        <StateBlock kind="login-required">
            {#snippet actions()}<Button href={loginHref(router.href)}>去登录</Button>{/snippet}
        </StateBlock>
    {:else if error?.status === 403}
        <StateBlock kind="forbidden" />
    {:else if error?.status === 404}
        <NotFoundContent />
    {:else}
        <StateBlock kind="error" description={userMessage(error)}>
            {#snippet actions()}{#if reload}<Button onclick={() => { void reload?.(); }}>重试</Button>{/if}{/snippet}
        </StateBlock>
    {/if}
{:else}
    <div class="resource-content" aria-busy={refreshing || undefined}>
        {#if refreshing}
            <div class="refresh-indicator" role="progressbar" aria-label="正在更新内容"><span></span></div>
        {/if}
        {@render children?.()}
    </div>
{/if}

<style>
    .loading-space { min-height: calc(var(--space-12) * 3); }
    .resource-content { position: relative; display: grid; gap: var(--space-6); min-width: 0; }
    .refresh-indicator { position: absolute; inset-inline: 0; inset-block-start: calc(var(--space-2) * -1); height: var(--space-1); overflow: hidden; border-radius: var(--radius-full); background: var(--color-accent-soft); pointer-events: none; }
    .refresh-indicator span { display: block; width: 35%; height: 100%; border-radius: inherit; background: var(--color-accent); animation: refresh calc(var(--duration-base) * 6) var(--ease-out) infinite alternate; }
    @keyframes refresh { to { transform: translateX(185%); } }
    @media (prefers-reduced-motion: reduce) { .refresh-indicator span { animation: none; width: 100%; } }
</style>