<script lang="ts">
    import MyCoursesPage from "./MyCoursesPage.svelte";
    import CourseListPage from "./CourseListPage.svelte";
    import { session } from "$lib/session.svelte.js";
    import { router, setTitle } from "$lib/router/router.svelte.js";
    import type { PageProps } from "$lib/router/types";

    let { params }: PageProps = $props();
    const title = $derived(session.status === "authenticated" ? "我的课程与动态" : "全部课程");

    $effect(() => {
        if (router.pathname === "/") setTitle(title);
    });
</script>

{#if session.status === "authenticated"}
    {#key session.user?.id}<MyCoursesPage />{/key}
{:else}
    <CourseListPage {params} />
{/if}