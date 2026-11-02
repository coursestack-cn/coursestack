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
    import { trackPageLoading } from "$lib/components/shell/PageLoading.svelte";
    import { router } from "$lib/router/router.svelte.js";
    import { loginHref } from "$lib/router/urls";
    import { isAborted, userMessage } from "$lib/api/errors";

    let { status, error = null, refreshing = false, reload, children }: Props = $props();
    let showLoading = $state(false);

    trackPageLoading(() => status === "loading" ? showLoading : status === "ready" && refreshing);

    $effect(() => {
        showLoading = false;
        if (status !== "loading") return;
        const timer = window.setTimeout(() => { showLoading = true; }, 200);
        return () => window.clearTimeout(timer);
    });
</script>

{#if status === "error" && !isAborted(error)}
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
{:else if status !== "loading"}
    <div class="resource-content" aria-busy={refreshing || undefined}>
        {@render children?.()}
    </div>
{/if}

<style>
    .resource-content { position: relative; display: grid; gap: var(--space-6); min-width: 0; }
</style>