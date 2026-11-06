<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { favorites, favoriteHref } from "$lib/favorites.svelte";
    import { session } from "$lib/session.svelte";
    import { router, updateQuery } from "$lib/router/router.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { pageCount, pageNumber, type Page } from "../questions/data";

    type Event = { id: number; type: "question_created" | "material_created" | "material_version"; contentId: string;
        kind: "question" | "material"; title: string; version: number | null; createdAt: number; courseId: string; courseName: string };
    const page = $derived(pageNumber(router.query.get("feedPage")));
    const result = resource(async signal => {
        favorites.revision;
        const viewer = session.user?.id;
        const data = await api.get<Page<Event> & { viewer: string }>(`/api/me/feed?page=${page}&pageSize=20`, { signal });
        return { ...data, requestViewer: viewer };
    });
    const current = $derived(result.data?.viewer === session.user?.id && result.data?.requestViewer === session.user?.id ? result.data : undefined);
    $effect(() => { if (current && !result.refreshing && current.page === page && page > pageCount(current)) void updateQuery({ feedPage: pageCount(current) === 1 ? null : pageCount(current) }, { replace: true }); });
</script>

<section class="course-feed" aria-labelledby="course-feed-title">
    <header><div><h2 id="course-feed-title">课程动态</h2><p>来自本学期修读、授课及收藏的课程</p></div><Button size="sm" disabled={result.refreshing} onclick={result.reload}>刷新</Button></header>
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if current}
            {#each current.items as item (item.id)}
                <article>
                    <p class="meta"><Link href={favoriteHref("course", item.courseId)}>{item.courseName}</Link><span>{item.type === "question_created" ? "新问题" : item.type === "material_created" ? "新资料" : `更新至版本 ${item.version}`}</span></p>
                    <h3><Link href={favoriteHref(item.kind, item.contentId)}>{item.title}</Link></h3>
                    <p class="meta"><RelativeTime timestamp={item.createdAt} /></p>
                </article>
            {:else}<StateBlock kind="empty" title="暂无课程动态" description="相关课程发布新资料、新问题或资料版本后，会显示在这里。" />{/each}
            <Pagination {page} pageCount={pageCount(current)} disabled={result.refreshing} onchange={(next: number) => { void updateQuery({ feedPage: next === 1 ? null : next }); }} />
        {/if}
    </ResourceState>
</section>

<style>
    .course-feed { display: grid; gap: var(--space-4); padding-top: var(--space-6); border-top: 1px solid var(--color-border); }
    header { display: flex; justify-content: space-between; gap: var(--space-4); align-items: center; }
    header p, .meta { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .meta { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    h2 { font-size: var(--font-size-xl); } h3 { font-size: var(--font-size-lg); }
    article { display: grid; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); overflow-wrap: anywhere; }
</style>