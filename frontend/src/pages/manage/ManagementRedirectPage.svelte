<script lang="ts">
    import { onMount } from "svelte";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import { router, redirect } from "$lib/router/router.svelte.js";
    import type { PageProps } from "$lib/router/types";

    let { params: _params }: PageProps = $props();

    onMount(() => {
        const query = new URLSearchParams(router.query);
        const target = router.pathname === "/admin/courses" ? "/manage/courses" : "/manage/accounts";
        redirect(`${target}${query.size ? `?${query}` : ""}${window.location.hash}`);
    });
</script>

<PageLayout title="正在打开管理页面"><ResourceState status="loading" /></PageLayout>