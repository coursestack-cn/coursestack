<script lang="ts">
    import { untrack, type Component } from "svelte";
    import { ApiError } from "$lib/api/client";
    import { session } from "$lib/session.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import CourseLayout from "$lib/components/shell/CourseLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { router, redirect, finishNavigation } from "$lib/router/router.svelte.js";
    import { loginDestination, loginHref } from "$lib/router/urls";
    import type { PageProps, Route } from "$lib/router/types";

    let Page = $state.raw<Component<PageProps> | null>(null);
    let loading = $state(true);
    let loadError = $state<ApiError | null>(null);
    let loadedRoute = $state.raw<Route | null>(null);
    const route = $derived(router.route);
    const pending = $derived(loading || loadedRoute !== route);
    const courseCode = $derived(route.layout === "course" ? router.params.courseCode : undefined);
    const loginRoute = $derived(route.path === "/login" || route.path === "/admin/login");
    const checksSession = $derived(route.path === "/" || route.requiresAuth || loginRoute);
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
        const currentRoute = route, load = currentRoute.load;
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
            loadedRoute = currentRoute;
            loading = false;
        }, () => {
            if (cancelled) return;
            loadError = new ApiError(0, "PAGE_LOAD_ERROR", "页面加载失败，可能是网络中断或网站已更新。重新加载后再试。");
            loadedRoute = currentRoute;
            loading = false;
        });
        return () => { cancelled = true; };
    });

    $effect(() => {
        if (!waitingSession && !redirecting && !pending) void finishNavigation(router.navigationId);
    });
</script>

{#snippet content()}
    {#if waitingSession || redirecting}
        <ResourceState status={session.error ? "error" : "loading"} error={session.error} reload={session.retry} />
    {:else if pending}
        <ResourceState status="loading" />
    {:else if loadError}
        <StateBlock kind="error" description={loadError.message}>
            {#snippet actions()}<Button onclick={() => window.location.reload()}>重新加载</Button>{/snippet}
        </StateBlock>
    {:else if Page}
        {#key router.pathname}<Page params={router.params} />{/key}
    {/if}
{/snippet}

{#if courseCode}
    {#key courseCode}<CourseLayout {courseCode}>{@render content()}</CourseLayout>{/key}
{:else if waitingSession || redirecting || pending || loadError}
    <PageLayout title={route.title}>{@render content()}</PageLayout>
{:else}
    {@render content()}
{/if}