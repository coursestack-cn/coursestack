<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { session } from "$lib/session.svelte";
    import { router, updateQuery } from "$lib/router/router.svelte";
    import { loginHref } from "$lib/router/urls";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import CourseContentItem from "./CourseContentItem.svelte";
    import { courseQuestionsHref, encode, pageCount, pageNumber, type Course, type Page } from "../questions/data";
    import { type CourseContent } from "../materials/data";

    let { course }: { course: Course } = $props();
    const kind = $derived(router.query.get("kind") === "question" ? "question" : router.query.get("kind") === "material" ? "material" : "all");
    const solutionState = $derived(kind === "question" && ["solved", "unresolved"].includes(router.query.get("state") ?? "") ? router.query.get("state")! : "all");
    const sort = $derived(router.query.get("sort") === "newest" ? "newest" : kind === "question" && router.query.get("sort") === "score" ? "score" : "active");
    const tag = $derived(router.query.get("tag")?.trim() ?? "");
    const page = $derived(pageNumber(router.query.get("page")));
    let tagInput = $state<string | number>("");
    $effect(() => { tagInput = tag; });
    const tagError = $derived(Array.from(String(tagInput).trim()).length > 30 ? "标签最多 30 个字符" : undefined);
    const result = resource(async signal => {
        const id = course.id;
        session.user?.id;
        const query = new URLSearchParams({ kind, state: solutionState, sort, page: String(page), pageSize: "20" });
        if (tag) query.set("tag", tag);
        return api.get<Page<CourseContent>>(`/api/courses/${encode(id)}/contents?${query}`, { signal });
    });
    $effect(() => {
        if (result.data && !result.refreshing && page > pageCount(result.data)) void updateQuery({ page: pageCount(result.data) }, { replace: true });
    });
    function changeKind(value: string) {
        void updateQuery({ kind: value === "all" ? null : value, state: null, sort: sort === "score" ? null : sort, page: null });
    }
    function creationHref(action: "questions" | "materials") {
        const path = `${courseQuestionsHref(course)}/${action}/new`;
        return session.user ? path : loginHref(path);
    }
</script>

<section class="course-contents">
    <header class="heading">
        <h2>资料与问答</h2>
        <div class="actions"><Button href={creationHref("materials")}>上传资料</Button><Button variant="primary" href={creationHref("questions")}>提出问题</Button></div>
    </header>
    <div class="filters">
        <Field label="内容类型">{#snippet children({ id })}<Select {id} value={kind} options={[{ value: "all", label: "全部内容" }, { value: "material", label: "资料" }, { value: "question", label: "问答" }]} onchange={event => changeKind(event.currentTarget.value)} />{/snippet}</Field>
        {#if kind === "question"}<Field label="解决状态">{#snippet children({ id })}<Select {id} value={solutionState} options={[{ value: "all", label: "全部状态" }, { value: "unresolved", label: "未解决" }, { value: "solved", label: "已解决" }]} onchange={event => { void updateQuery({ state: event.currentTarget.value === "all" ? null : event.currentTarget.value, page: null }); }} />{/snippet}</Field>{/if}
        <Field label="排序">{#snippet children({ id })}<Select {id} value={sort} options={[{ value: "active", label: "最近活跃" }, { value: "newest", label: "最新发布" }, ...(kind === "question" ? [{ value: "score", label: "净赞数" }] : [])]} onchange={event => { void updateQuery({ sort: event.currentTarget.value === "active" ? null : event.currentTarget.value, page: null }); }} />{/snippet}</Field>
        <form class="tag-filter" onsubmit={event => { event.preventDefault(); if (!tagError) void updateQuery({ tag: String(tagInput).trim() || null, page: null }); }}>
            <Field label="标签" error={tagError}>{#snippet children({ id })}<TextInput {id} bind:value={tagInput} placeholder="按完整标签筛选" />{/snippet}</Field>
            <Button type="submit" disabled={Boolean(tagError)}>筛选</Button>
            {#if tag}<Button variant="ghost" onclick={() => { void updateQuery({ tag: null, page: null }); }}>清除标签</Button>{/if}
        </form>
    </div>
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if result.data}
            <p class="summary">共 {result.data.total} 项{#if tag}，标签：{tag}{/if}</p>
            {#if result.data.items.length}
                <div class="items">{#each result.data.items as item (item.id)}<CourseContentItem {item} />{/each}</div>
                {#if pageCount(result.data) > 1}<Pagination page={result.data.page} pageCount={pageCount(result.data)} disabled={result.refreshing} onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }); }} />{/if}
            {:else}<StateBlock kind="empty" title={kind !== "all" || tag || solutionState !== "all" ? "没有符合条件的内容" : "还没有资料或问题"} description="上传一份资料，或提出你的问题。">
                {#snippet actions()}{#if kind !== "all" || tag || solutionState !== "all"}<Button href={courseQuestionsHref(course)}>查看全部内容</Button>{/if}{/snippet}
            </StateBlock>{/if}
        {/if}
    </ResourceState>
</section>

<style>
    .course-contents { display: grid; gap: var(--space-5); min-width: 0; }
    .heading, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    .heading { justify-content: space-between; }
    h2 { font-size: var(--font-size-xl); }
    .filters { display: flex; flex-wrap: wrap; align-items: start; gap: var(--space-3); }
    .filters > :global(.field) { min-width: 8rem; }
    .tag-filter { display: flex; flex: 1 1 18rem; gap: var(--space-2); align-items: end; flex-wrap: wrap; }
    .tag-filter > :global(.field) { flex: 1; min-width: 10rem; }
    .summary { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .items { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
    .items > :global(article:first-child > .course-content-link) { border-top-left-radius: calc(var(--radius-lg) - 1px); border-top-right-radius: calc(var(--radius-lg) - 1px); }
    .items > :global(article:last-child > .course-content-link) { border-bottom-left-radius: calc(var(--radius-lg) - 1px); border-bottom-right-radius: calc(var(--radius-lg) - 1px); }
    .items :global(article:last-child) { border-bottom: 0; }
</style>