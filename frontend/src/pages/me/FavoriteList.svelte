<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { favorites, favoriteHref, type FavoriteList } from "$lib/favorites.svelte";
    import { session } from "$lib/session.svelte";
    import { router, updateQuery } from "$lib/router/router.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import FavoriteButton from "$lib/components/content/FavoriteButton.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import Tabs from "$lib/components/ui/Tabs.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { pageCount, pageNumber } from "../questions/data";

    let { coursesOnly = false }: { coursesOnly?: boolean } = $props();
    const type = $derived(coursesOnly ? "course" : ["course", "material", "question"].includes(router.query.get("type") ?? "") ? router.query.get("type")! : "all");
    const courseId = $derived(coursesOnly ? "" : router.query.get("courseId") ?? "");
    const page = $derived(pageNumber(router.query.get("page")));
    const labels = { all: "全部", course: "课程", material: "资料", question: "问题" };
    const queryKey = $derived.by(() => {
        const query = new URLSearchParams({ type, page: String(page), pageSize: "20" });
        if (courseId) query.set("courseId", courseId);
        return query.toString();
    });
    const result = resource(async signal => {
        favorites.revision;
        const viewer = session.user?.id;
        const key = queryKey;
        const data = await api.get<FavoriteList>(`/api/me/favorites?${key}`, { signal });
        return { ...data, requestViewer: viewer, key };
    });
    const current = $derived(result.data?.viewer === session.user?.id && result.data?.requestViewer === session.user?.id ? result.data : undefined);
    const tabs = $derived(Object.entries(labels).map(([value, label]) => ({ value, label, count: current?.counts[value as keyof typeof labels] })));
    $effect(() => {
        if (current?.key === queryKey && !result.refreshing && current.page === page && page > pageCount(current)) void updateQuery({ page: pageCount(current) === 1 ? null : pageCount(current) }, { replace: true });
    });
</script>

<div class="favorites-list">
    {#if !coursesOnly}
        <Tabs items={tabs} value={type} label="收藏类型" onchange={next => { void updateQuery({ type: next === "all" ? null : next, page: null }); }} />
        <Field label="所属课程">{#snippet children({ id })}<Select {id} value={courseId}
            options={[{ value: "", label: "全部课程" }, ...(current?.courses ?? []).map(course => ({ value: course.id, label: course.name }))]}
            onchange={event => { void updateQuery({ courseId: event.currentTarget.value || null, page: null }); }} />{/snippet}</Field>
    {/if}
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if current}
            <p class="summary" role="status">共 {current.total} 项收藏</p>
            {#each current.items as item (item.favoriteId)}
                <article>
                    <div class="details">
                        <p class="meta">{labels[item.type]}{#if item.type !== "course"}<span>{item.courseName}</span>{/if}</p>
                        <h2>{#if item.available}<Link href={favoriteHref(item.type, item.targetId)}>{item.title}</Link>{:else}内容不可用{/if}</h2>
                        {#if item.description}<p class="description">{item.description}</p>{/if}
                        <p class="meta">收藏于 <RelativeTime timestamp={item.createdAt} /></p>
                    </div>
                    <FavoriteButton type={item.type} id={item.targetId} available={item.available} removeLabel />
                </article>
            {:else}<StateBlock kind="empty" title={courseId ? "该课程下暂无收藏" : coursesOnly ? "还没有收藏课程" : "暂无收藏"} description="在课程、资料或问题页面点击收藏，方便以后查找和跟进更新。" />{/each}
            <Pagination {page} pageCount={pageCount(current)} disabled={result.refreshing} onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }); }} />
        {/if}
    </ResourceState>
</div>

<style>
    .favorites-list { display: grid; gap: var(--space-4); min-width: 0; }
    article { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .details { display: grid; gap: var(--space-2); min-width: 0; overflow-wrap: anywhere; }
    h2 { font-size: var(--font-size-lg); }
    .meta, .summary { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .meta { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .description { white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    @media (max-width: 639px) { article { align-items: flex-start; flex-wrap: wrap; } }
</style>