<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { router, updateQuery } from "$lib/router/router.svelte.js";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Tabs from "$lib/components/ui/Tabs.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { pageCount, pageNumber } from "../questions/data";
    import TeacherContentItem from "./TeacherContentItem.svelte";
    import { teacherTabs, type TeacherCounts, type TeacherActivity } from "./data";

    let { teacherId, counts }: { teacherId: string; counts: TeacherCounts } = $props();
    const tab = $derived(teacherTabs.find(item => item.value === router.query.get("tab")) ?? teacherTabs[0]);
    const page = $derived(pageNumber(router.query.get("page")));
    const result = resource(signal => {
        const query = new URLSearchParams({ kind: tab.kind, page: String(page), pageSize: "20" });
        return api.get<TeacherActivity>(`/api/teachers/${encodeURIComponent(teacherId)}/activity?${query}`, { signal });
    });
    const status = $derived(result.data && result.data.kind !== tab.kind ? "loading" : result.status);
    const tabs = $derived(teacherTabs.map(item => ({ value: item.value, label: item.label,
        count: result.data?.kind === item.kind ? result.data.total : counts[item.value] })));
    $effect(() => {
        const data = result.data;
        if (data && data.kind === tab.kind && data.page === page && !result.refreshing && page > pageCount(data)) {
            void updateQuery({ page: pageCount(data) === 1 ? null : pageCount(data) }, { replace: true });
        }
    });
</script>

<Tabs items={tabs} value={tab.value} label="教师公开内容" onchange={next => { void updateQuery({ tab: next === "courses" ? null : next, page: null }); }}>
    <ResourceState {status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if result.data && result.data.kind === tab.kind}
            {@const data = result.data}
            {#if data.items.length}
                <div class="items">
                    {#each data.items as item (item.id)}
                        {#if item.kind === "course"}
                            <article class="course-item">
                                <Link class="teacher-course-link" href={`/courses/${encodeURIComponent(item.id)}`}>
                                    <p class="course-code">{item.id}</p><h2>{item.name}</h2>
                                    {#if item.introduction.trim()}<p class="introduction">{item.introduction}</p>{/if}
                                    <p class="terms">授课学期：{item.terms.map(term => `${term.name}${term.current ? "（本学期）" : ""}`).join("、")}</p>
                                </Link>
                            </article>
                        {:else}<TeacherContentItem {item} />{/if}
                    {/each}
                </div>
                {#if pageCount(data) > 1}<Pagination page={data.page} pageCount={pageCount(data)} disabled={result.refreshing}
                    onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }, { scroll: "top" }); }} />{/if}
            {:else if data.total > 0}<StateBlock kind="loading" title="正在调整页码" />
            {:else}<StateBlock kind="empty" title={tab.empty} />{/if}
        {/if}
    </ResourceState>
</Tabs>

<style>
    .items { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
    .items :global(article:last-child) { border-bottom: 0; }
    .course-item { min-width: 0; border-bottom: 1px solid var(--color-border); }
    .course-item :global(.teacher-course-link) { display: grid; gap: var(--space-3); min-width: 0; padding: var(--space-5); color: var(--color-text); text-decoration: none; }
    .course-item :global(.teacher-course-link:hover) { background: var(--color-surface-sunken); text-decoration: none; }
    .course-item :global(.teacher-course-link:active) { background: var(--color-accent-soft); }
    .course-item :global(.teacher-course-link:focus-visible) { outline-offset: -2px; }
    h2 { color: var(--color-accent); font-size: var(--font-size-lg); overflow-wrap: anywhere; }
    .course-code, .terms { color: var(--color-text-secondary); font-size: var(--font-size-sm); overflow-wrap: anywhere; }
    .course-code { font-family: var(--font-mono); }
    .introduction { white-space: pre-line; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    @media (max-width: 639px) { .course-item :global(.teacher-course-link) { padding: var(--space-3); } }
</style>