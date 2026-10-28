<script lang="ts">
    import { Plus, MessageSquare } from "@lucide/svelte";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { router, updateQuery, setTitle } from "$lib/router/router.svelte.js";
    import { loginHref } from "$lib/router/urls";
    import { session } from "$lib/session.svelte.js";
    import type { PageProps } from "$lib/router/types";
    import { getCourse } from "$lib/components/shell/CourseLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import QuestionListItem from "$lib/components/content/QuestionListItem.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { courseQuestionsHref, encode, pageCount, pageNumber, questionView, type Page, type Content } from "./data";

    let { params }: PageProps = $props();
    const course = getCourse()!;
    const states = [{ value: "all", label: "全部问题" }, { value: "unresolved", label: "未解决" }, { value: "solved", label: "已解决" }];
    const sorts = [{ value: "active", label: "近期活跃" }, { value: "newest", label: "最新发布" }, { value: "score", label: "净赞数" }];
    const stateFilter = $derived(states.some(x => x.value === router.query.get("state")) ? router.query.get("state")! : "all");
    const sort = $derived(sorts.some(x => x.value === router.query.get("sort")) ? router.query.get("sort")! : "active");
    const tag = $derived((router.query.get("tag") ?? "").trim());
    const page = $derived(pageNumber(router.query.get("page")));
    let tagInput = $state<string | number>("");
    const result = resource(async signal => {
        const entry = course.data!;
        const query = new URLSearchParams({ state: stateFilter, sort, page: String(page), pageSize: "20" });
        const filter = tag;
        if (Array.from(filter).length > 30) return { entry, list: null };
        if (filter) query.set("tag", filter);
        const list = await api.get<Page<Content>>(`/api/courses/${encode(entry.course.id)}/questions?${query}`, { signal });
        return { entry, list };
    });
    $effect(() => { tagInput = tag; });
    $effect(() => {
        if (result.data) setTitle(`${result.data.entry.course.name} · 问答`);
        const list = result.data?.list;
        if (list && !result.refreshing && list.page === page && page > pageCount(list)) {
            void updateQuery({ page: pageCount(list) === 1 ? null : pageCount(list) }, { replace: true });
        }
    });
    function filterTag() {
        const value = String(tagInput).trim();
        if (Array.from(value).length > 30) return;
        void updateQuery({ tag: value || null, page: null }, { scroll: "top" });
    }
</script>

<div class="list-heading">
    <div><h2>问答</h2><p>交流思路，解答课程中的问题。</p></div>
    <Button variant="primary" href={session.user ? `/courses/${encode(params.courseCode!)}/questions/new` : loginHref(`/courses/${encode(params.courseCode!)}/questions/new`)}>
        {#snippet icon()}<Plus size="1em" />{/snippet}提出问题
    </Button>
</div>
<div class="filters">
    <Field label="解决状态">{#snippet children({ id })}<Select {id} options={states} value={stateFilter} onchange={event => { void updateQuery({ state: event.currentTarget.value, page: null }); }} />{/snippet}</Field>
    <Field label="排序">{#snippet children({ id })}<Select {id} options={sorts} value={sort} onchange={event => { void updateQuery({ sort: event.currentTarget.value, page: null }); }} />{/snippet}</Field>
    <form class="tag-filter" onsubmit={event => { event.preventDefault(); filterTag(); }}>
        <Field label="标签" error={Array.from(String(tagInput)).length > 30 ? "标签最多 30 个字符" : undefined}>
            {#snippet children({ id, describedBy, invalid })}<TextInput {id} aria-describedby={describedBy} {invalid} bind:value={tagInput} placeholder="按完整标签筛选" />{/snippet}
        </Field>
        <Button type="submit">筛选</Button>
        {#if tag}<Button onclick={() => { void updateQuery({ tag: null, page: null }); }}>清除</Button>{/if}
    </form>
</div>
<ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
    {#if result.data}
        {@const list = result.data.list}
        {#if !list}<StateBlock kind="error" title="标签过长" description="标签最多 30 个字符，缩短后重新筛选。" />
        {:else}
            <p class="summary" role="status">共 {list.total} 个问题{tag ? ` · 标签：${tag}` : ""}</p>
            {#if list.items.length}
                <div class="question-list">{#each list.items as question (question.id)}<QuestionListItem question={questionView(question)} />{/each}</div>
                {#if pageCount(list) > 1}<Pagination page={list.page} pageCount={pageCount(list)} disabled={result.refreshing} onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }, { scroll: "top" }); }} />{/if}
            {:else if list.total > 0}<StateBlock kind="loading" title="正在调整页码" />
            {:else}<StateBlock kind="empty" title={tag || stateFilter !== "all" ? "没有符合条件的问题" : "还没有问题"} description="分享遇到的问题，和大家一起讨论。">
                {#snippet icon()}<MessageSquare size="1em" />{/snippet}
                {#snippet actions()}{#if tag || stateFilter !== "all"}<Button href={courseQuestionsHref(result.data!.entry.course)}>查看全部问题</Button>{/if}{/snippet}
            </StateBlock>{/if}
        {/if}
    {/if}
</ResourceState>

<style>
    .list-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-4); }
    .list-heading p, .summary { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .filters { display: flex; flex-wrap: wrap; align-items: start; gap: var(--space-4); }
    .tag-filter { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2); }
    .question-list { overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .question-list :global(article:last-child) { border-bottom: 0; }
    @media (max-width: 639px) { .filters { display: grid; grid-template-columns: 1fr 1fr; } .tag-filter { grid-column: 1 / -1; } }
</style>