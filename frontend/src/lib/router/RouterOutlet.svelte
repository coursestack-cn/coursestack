<script lang="ts">
    import { untrack, type Component } from "svelte";
    import { ApiError } from "$lib/api/client";
    import { session } from "$lib/session.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { router, redirect, finishNavigation } from "$lib/router/router.svelte.js";
    import { loginDestination, loginHref } from "$lib/router/urls";
    import type { PageProps } from "$lib/router/types";

    let Page = $state.raw<Component<PageProps> | null>(null);
    let loading = $state(true);
    let loadError = $state<ApiError | null>(null);
    const route = $derived(router.route);
    const loginRoute = $derived(route.path === "/login" || route.path === "/admin/login");
    const checksSession = $derived(route.requiresAuth || loginRoute);
    const waitingSession = $derived(checksSession && session.status === "loading");
    const passwordChangeRequired = $derived(session.status === "authenticated" && session.user?.mustChangePassword && route.path !== "/settings/password");
    const redirecting = $derived(!router.authRedirectDeferred && (passwordChangeRequired || (router.route.requiresAuth && session.status === "anonymous")
        || (loginRoute && session.status === "authenticated")));

    $effect(() => {
        if (router.authRedirectDeferred) return;
        if (passwordChangeRequired) {
            redirect("/settings/password");
        } else if (router.route.requiresAuth && session.status === "anonymous") {
            redirect(loginHref(router.href));
        } else if (loginRoute && session.status === "authenticated") {
            redirect(loginDestination(router.query.get("next")));
        }
    });

    $effect(() => {
        const load = route.load;
        if (waitingSession || redirecting) {
            Page = null;
            return;
        }
        let cancelled = false;
        loading = true;
        loadError = null;
        Page = null;
        void untrack(load).then((module) => {
            if (cancelled) return;
            Page = module.default;
            loading = false;
        }, () => {
            if (cancelled) return;
            loadError = new ApiError(0, "PAGE_LOAD_ERROR", "页面加载失败，可能是网络中断或网站已更新。重新加载后再试。");
            loading = false;
        });
        return () => { cancelled = true; };
    });

    $effect(() => {
        if (!waitingSession && !redirecting && !loading) void finishNavigation(router.navigationId);
    });
</script>

{#if waitingSession || redirecting}
    <PageLayout title={router.route.title}>
        <ResourceState status={session.error ? "error" : "loading"} error={session.error} reload={session.retry} />
    </PageLayout>
{:else if loading}
    <PageLayout title={router.route.title}><ResourceState status="loading" /></PageLayout>
{:else if loadError}
    <PageLayout title={router.route.title}>
        <StateBlock kind="error" description={loadError.message}>
            {#snippet actions()}<Button onclick={() => window.location.reload()}>重新加载</Button>{/snippet}
        </StateBlock>
    </PageLayout>
{:else if Page}
    {#key router.pathname}<Page params={router.params} />{/key}
{/if}