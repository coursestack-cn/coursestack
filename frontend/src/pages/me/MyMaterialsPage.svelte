<script lang="ts">
    import { type PageProps } from "$lib/router/types";
    let {}: PageProps = $props();
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { session } from "$lib/session.svelte";
    import { router, updateQuery } from "$lib/router/router.svelte";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import CourseContentItem from "../courses/CourseContentItem.svelte";
    import { pageCount, pageNumber, type Page } from "../questions/data";
    import { type CourseContent } from "../materials/data";
    const page = $derived(pageNumber(router.query.get("page")));
    const result = resource(async signal => {
        session.user?.id;
        return api.get<Page<CourseContent>>(`/api/me/activity?kind=material&page=${page}&pageSize=20`, { signal });
    });
    $effect(() => { if (result.data && !result.refreshing && page > pageCount(result.data)) void updateQuery({ page: pageCount(result.data) }, { replace: true }); });
</script>

<PageLayout title="我的资料" subtitle="查看你分享的资料与最新版本。">
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if result.data}
            {#if result.data.items.length}
                <p class="summary">共 {result.data.total} 份资料</p>
                <div class="items">{#each result.data.items as item (item.id)}<CourseContentItem {item} />{/each}</div>
                {#if pageCount(result.data) > 1}<Pagination page={result.data.page} pageCount={pageCount(result.data)} disabled={result.refreshing} onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }); }} />{/if}
            {:else}<StateBlock kind="empty" title="还没有上传资料" description="进入课程，分享你的第一份资料。">{#snippet actions()}<Button href="/courses">浏览课程</Button>{/snippet}</StateBlock>{/if}
        {/if}
    </ResourceState>
</PageLayout>

<style>
    .summary { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .items { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
    .items :global(article:last-child) { border-bottom: 0; }
</style>