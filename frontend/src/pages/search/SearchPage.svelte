<script lang="ts">
    import type { PageProps } from "$lib/router/types";
    import { parseSearchQuery } from "../../../../shared/search";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { router, updateQuery, setTitle } from "$lib/router/router.svelte";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import SearchInput from "$lib/components/ui/SearchInput.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Tabs from "$lib/components/ui/Tabs.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import { pageNumber, pageCount } from "../questions/data";
    import CourseFilter from "./CourseFilter.svelte";
    import SearchItem from "./SearchItem.svelte";
    import type { SearchPage } from "./data";

    let {}: PageProps = $props();
    const tabs = [{ value: "all", label: "全部" }, { value: "course", label: "课程" }, { value: "material", label: "资料" },
        { value: "question", label: "问题" }, { value: "answer", label: "回答" }];
    const parsed = $derived(parseSearchQuery(router.query.get("q") ?? ""));
    const type = $derived(tabs.some(tab => tab.value === router.query.get("type")) ? router.query.get("type")! : "all");
    const course = $derived(router.query.get("course") ?? "");
    const tag = $derived(router.query.get("tag")?.trim() ?? "");
    const sort = $derived(router.query.get("sort") === "updated" ? "updated" : "relevance");
    const page = $derived(pageNumber(router.query.get("page")));
    let input = $state(""), tagInput = $state<string | number>("");
    $effect(() => { input = parsed.q; });
    $effect(() => { tagInput = tag; });
    $effect(() => { setTitle(parsed.q ? `${parsed.q} - 搜索` : "搜索"); });
    const inputError = $derived(parseSearchQuery(input).error);
    const tagError = $derived(Array.from(String(tagInput).trim()).length > 30 ? "标签最多30个字符。" : undefined);
    const activeError = $derived(parsed.error ?? (Array.from(tag).length > 30 ? "标签最多30个字符。" : type === "course" && tag ? "课程结果不支持标签筛选，请清除标签。" : null));
    const requestKey = $derived.by(() => {
        const query = new URLSearchParams({ q: parsed.q, type, sort, page: String(page), pageSize: "20" });
        if (course) query.set("course", course);
        if (tag) query.set("tag", tag);
        return query.toString();
    });
    const result = resource(async signal => {
        const key = requestKey;
        if (!parsed.q || activeError) return null;
        return { data: await api.get<SearchPage>(`/api/search?${key}`, { signal }), key };
    });
    const data = $derived(result.data?.key === requestKey ? result.data.data : null);
    const status = $derived(result.status === "error" ? "error" : result.data && !data ? "loading" : result.status);
    $effect(() => {
        if (data && !result.refreshing && data.page === page && page > pageCount(data)) {
            void updateQuery({ page: pageCount(data) === 1 ? null : pageCount(data) }, { replace: true });
        }
    });
    function submit() {
        if (inputError || tagError) return;
        const q = parseSearchQuery(input).q, nextTag = type === "course" ? "" : String(tagInput).trim();
        if (q === parsed.q && nextTag === tag && page === 1) result.reload();
        else void updateQuery({ q: q || null, tag: nextTag || null, page: null });
    }
    function changeType(next: string) {
        void updateQuery({ type: next === "all" ? null : next, tag: next === "course" ? null : tag || null, page: null });
    }
</script>

<PageLayout title="搜索">
    <form class="search-form" role="search" aria-label="全站搜索" onsubmit={event => { event.preventDefault(); submit(); }}>
        <Field label="关键词" error={inputError ?? undefined} help="用空格分隔多个关键词，同时查找课程、资料、问题和回答。">
            {#snippet children({ id, describedBy, invalid })}
                <div class="search-controls">
                    <SearchInput {id} {invalid} aria-describedby={describedBy} bind:value={input} placeholder="搜索课程、资料、问题和回答"
                        onsubmit={submit} onclear={() => { void updateQuery({ q: null, page: null }); }} />
                    <Button type="submit" variant="primary" disabled={Boolean(inputError || tagError)}>搜索</Button>
                </div>
            {/snippet}
        </Field>
    </form>
    <Tabs items={tabs} value={type} label="搜索结果类型" onchange={changeType}>
        <div class="content">
            <div class="filters">
                <Field label="课程范围">{#snippet children({ id })}<CourseFilter {id} value={course} onchange={next => { void updateQuery({ course: next || null, page: null }); }} />{/snippet}</Field>
                {#if type !== "course"}
                    <form class="tag-filter" onsubmit={event => { event.preventDefault(); submit(); }}>
                        <Field label="标签" error={tagError}>{#snippet children({ id, describedBy, invalid })}<TextInput {id} {invalid} aria-describedby={describedBy} bind:value={tagInput} placeholder="标签关键词" />{/snippet}</Field>
                        <Button type="submit" disabled={Boolean(inputError || tagError)}>筛选</Button>
                    </form>
                {/if}
                <Field label="排序">{#snippet children({ id })}<Select {id} value={sort}
                    options={[{ value: "relevance", label: "相关度" }, { value: "updated", label: "最近更新" }]}
                    onchange={event => { void updateQuery({ sort: event.currentTarget.value === "relevance" ? null : "updated", page: null }); }} />{/snippet}</Field>
                {#if course || tag || type !== "all"}<Button variant="ghost" onclick={() => { void updateQuery({ course: null, tag: null, type: null, page: null }); }}>清除筛选</Button>{/if}
            </div>
            {#if activeError}
                <StateBlock kind="error" title="搜索条件无效" description={activeError} />
            {:else if !parsed.q}
                <StateBlock kind="empty" title="输入关键词开始搜索" description="可以搜索课程名称和编号、资料介绍，以及问题和回答中的文字。" />
            {:else}
                <ResourceState {status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
                    {#if data}
                        <p class="summary" role="status">“{data.q}”共找到 {data.total} 项结果</p>
                        {#if data.items.length}
                            <div class="results">{#each data.items as item (`${item.kind}:${item.id}`)}<SearchItem {item} />{/each}</div>
                            {#if pageCount(data) > 1}<Pagination {page} pageCount={pageCount(data)} disabled={result.refreshing}
                                onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }, { scroll: "top" }); }} />{/if}
                        {:else}<StateBlock kind="empty" title="没有找到相关内容" description="试试更短的关键词，或放宽课程和标签筛选。" />{/if}
                    {/if}
                </ResourceState>
            {/if}
        </div>
    </Tabs>
</PageLayout>

<style>
    .search-controls, .tag-filter { display: flex; align-items: end; gap: var(--space-3); }
    .search-controls > :global(.search) { flex: 1; width: auto; }
    .search-controls > :global(button) { flex-shrink: 0; }
    .content { display: grid; gap: var(--space-4); }
    .filters { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-3); }
    .filters > :global(.field) { min-width: 8rem; }
    .tag-filter { flex: 1 1 15rem; }
    .tag-filter > :global(.field) { flex: 1; min-width: 0; }
    .summary { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .results { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
    @media (max-width: 639px) {
        .filters > :global(.field) { flex: 1 1 8rem; }
        .tag-filter { flex-basis: 100%; order: 1; }
    }
</style>