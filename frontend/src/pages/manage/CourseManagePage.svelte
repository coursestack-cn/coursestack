<script lang="ts">
    import { onMount } from "svelte";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import { router, redirect } from "$lib/router/router.svelte.js";
    import type { PageProps } from "$lib/router/types";
    import { courseClassesHref } from "./course";

    let { params }: PageProps = $props();

    onMount(() => {
        const query = new URLSearchParams();
        for (const key of ["termId", "page"]) {
            const value = router.query.get(key);
            if (value) query.set(key, value);
        }
        redirect(`${courseClassesHref(params.courseCode)}${query.size ? `?${query}` : ""}`);
    });
</script>

<PageLayout title="正在打开教学班列表"><ResourceState status="loading" /></PageLayout>