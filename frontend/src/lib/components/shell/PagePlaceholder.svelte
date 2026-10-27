<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { PageProps } from "$lib/router/types";

    export type Props = PageProps & { children?: Snippet };
</script>

<script lang="ts">
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import CourseNav from "$lib/components/shell/CourseNav.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { router } from "$lib/router/router.svelte.js";

    let { params, children }: Props = $props();
    const query = $derived(Array.from(router.query.entries()));
</script>

<PageLayout title={router.route.title}>
    {#if params.courseId}<CourseNav courseId={params.courseId} courseName={`课程 ${params.courseId}`} />{/if}
    <div class="placeholder">
        <StateBlock kind="empty" title="此页面尚未实现" />
    </div>
    {@render children?.()}
    <section class="route-details" aria-label="路由信息">
        <div><h2>路由参数</h2><pre>{JSON.stringify(params, null, 4)}</pre></div>
        <div><h2>查询参数</h2><pre>{JSON.stringify(query, null, 4)}</pre></div>
    </section>
</PageLayout>

<style>
    .placeholder { border: 1px dashed var(--color-border-strong); border-radius: var(--radius-lg); }
    .route-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); min-width: 0; }
    .route-details > div { min-width: 0; display: grid; align-content: start; gap: var(--space-2); }
    h2 { color: var(--color-text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-regular); }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (max-width: 639px) { .route-details { grid-template-columns: minmax(0, 1fr); } }
</style>