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
    import CourseAuthorFilter from "./CourseAuthorFilter.svelte";
    import { courseQuestionsHref, encode, pageCount, pageNumber, type Course, type Page } from "../questions/data";
    import type { Term } from "../manage/course";
    import { type CourseContent } from "../materials/data";

    let { course, terms = [], defaultTermId = "" }: { course: Course; terms?: Term[]; defaultTermId?: string } = $props();
    const termId = $derived(router.query.get("termId") ?? defaultTermId);
    const termOptions = $derived([{ value: "", label: "全部学期" }, ...terms.map(term => ({ value: term.id, label: `${term.name}${term.current ? "（本学期）" : ""}` })),
        ...(termId && !terms.some(term => term.id === termId) ? [{ value: termId, label: termId }] : [])]);
    const kind = $derived(router.query.get("kind") === "question" ? "question" : router.query.get("kind") === "material" ? "material" : "all");
    const solutionState = $derived(kind === "question" && ["solved", "unresolved"].includes(router.query.get("state") ?? "") ? router.query.get("state")! : "all");
    const sort = $derived(router.query.get("sort") === "newest" ? "newest" : kind === "question" && router.query.get("sort") === "score" ? "score" : "active");
    const authorId = $derived(router.query.get("authorId")?.trim() ?? "");
    const title = $derived(router.query.get("title")?.trim() ?? "");
    const tag = $derived(router.query.get("tag")?.trim() ?? "");
    const page = $derived(pageNumber(router.query.get("page")));
    let titleInput = $state<string | number>("");
    let tagInput = $state<string | number>("");
    $effect(() => { titleInput = title; });
    $effect(() => { tagInput = tag; });
    const titleError = $derived(Array.from(String(titleInput).trim()).length > 200 ? "标题最多 200 个字符" : undefined);
    const tagError = $derived(Array.from(String(tagInput).trim()).length > 30 ? "标签最多 30 个字符" : undefined);
    const result = resource(async signal => {
        const id = course.id, selectedTerm = termId, selectedTitle = title, selectedTag = tag, selectedAuthor = authorId;
        session.user?.id;
        const filters = { kind, state: solutionState, sort };
        const query = new URLSearchParams({ ...filters, page: String(page), pageSize: "20" });
        if (selectedAuthor) query.set("authorId", selectedAuthor);
        if (selectedTitle) query.set("title", selectedTitle);
        if (selectedTag) query.set("tag", selectedTag);
        if (selectedTerm) query.set("termId", selectedTerm);
        const data = await api.get<Page<CourseContent>>(`/api/courses/${encode(id)}/contents?${query}`, { signal });
        return { ...data, termId: selectedTerm, title: selectedTitle, tag: selectedTag, authorId: selectedAuthor, ...filters };
    });
    $effect(() => {
        if (result.data && !result.refreshing && result.data.page === page && result.data.termId === termId && result.data.title === title && result.data.tag === tag && result.data.authorId === authorId && result.data.kind === kind && result.data.state === solutionState && result.data.sort === sort && page > pageCount(result.data)) void updateQuery({ page: pageCount(result.data) }, { replace: true });
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
        <Field label="学期">{#snippet children({ id })}<Select {id} value={termId} options={termOptions}
            onchange={event => { const value = event.currentTarget.value; void updateQuery({ termId: value === defaultTermId ? null : value, page: null }); }} />{/snippet}</Field>
        <Field label="内容类型">{#snippet children({ id })}<Select {id} value={kind} options={[{ value: "all", label: "全部内容" }, { value: "material", label: "资料" }, { value: "question", label: "问答" }]} onchange={event => changeKind(event.currentTarget.value)} />{/snippet}</Field>
        <Field label="发布人">{#snippet children({ id, labelId })}<CourseAuthorFilter {id} {labelId} courseId={course.id} value={authorId}
            onchange={value => { void updateQuery({ authorId: value || null, page: null }); }} />{/snippet}</Field>
        {#if kind === "question"}<Field label="解决状态">{#snippet children({ id })}<Select {id} value={solutionState} options={[{ value: "all", label: "全部状态" }, { value: "unresolved", label: "未解决" }, { value: "solved", label: "已解决" }]} onchange={event => { void updateQuery({ state: event.currentTarget.value === "all" ? null : event.currentTarget.value, page: null }); }} />{/snippet}</Field>{/if}
        <Field label="排序">{#snippet children({ id })}<Select {id} value={sort} options={[{ value: "active", label: "最近活跃" }, { value: "newest", label: "最新发布" }, ...(kind === "question" ? [{ value: "score", label: "净赞数" }] : [])]} onchange={event => { void updateQuery({ sort: event.currentTarget.value === "active" ? null : event.currentTarget.value, page: null }); }} />{/snippet}</Field>
        <form class="text-filter" onsubmit={event => { event.preventDefault(); if (!titleError && !tagError) void updateQuery({ title: String(titleInput).trim() || null, tag: String(tagInput).trim() || null, page: null }); }}>
            <Field label="标题" error={titleError}>{#snippet children({ id, invalid, describedBy })}<TextInput {id} {invalid} aria-describedby={describedBy} bind:value={titleInput} placeholder="输入标题关键词" />{/snippet}</Field>
            <Field label="标签" error={tagError}>{#snippet children({ id, invalid, describedBy })}<TextInput {id} {invalid} aria-describedby={describedBy} bind:value={tagInput} placeholder="输入标签关键词" />{/snippet}</Field>
            <Button type="submit" disabled={Boolean(titleError || tagError)}>筛选</Button>
            {#if title || tag}<Button variant="ghost" aria-label="清除标题和标签" onclick={() => { titleInput = ""; tagInput = ""; void updateQuery({ title: null, tag: null, page: null }); }}>清除</Button>{/if}
        </form>
    </div>
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if result.data}
            <p class="summary">共 {result.data.total} 项{#if title}，标题：{title}{/if}{#if tag}，标签：{tag}{/if}</p>
            {#if result.data.items.length}
                <div class="items">{#each result.data.items as item (item.id)}<CourseContentItem {item} />{/each}</div>
                {#if pageCount(result.data) > 1}<Pagination page={result.data.page} pageCount={pageCount(result.data)} disabled={result.refreshing} onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }); }} />{/if}
            {:else}<StateBlock kind="empty" title={termId || kind !== "all" || authorId || title || tag || solutionState !== "all" ? "没有符合条件的内容" : "还没有资料或问题"} description="上传一份资料，或提出你的问题。">
                {#snippet actions()}{#if termId || kind !== "all" || authorId || title || tag || solutionState !== "all"}<Button onclick={() => { void updateQuery({ termId: defaultTermId ? "" : null, kind: null, state: null, sort: null, title: null, tag: null, authorId: null, page: null }); }}>查看全部内容</Button>{/if}{/snippet}
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
    .text-filter { display: flex; flex: 1 1 28rem; min-width: 0; gap: var(--space-2); align-items: end; flex-wrap: wrap; }
    .text-filter > :global(.field) { flex: 1 1 10rem; }
    .summary { color: var(--color-text-secondary); font-size: var(--font-size-sm); overflow-wrap: anywhere; }
    .items { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
    .items > :global(article:first-child > .course-content-link) { border-top-left-radius: calc(var(--radius-lg) - 1px); border-top-right-radius: calc(var(--radius-lg) - 1px); }
    .items > :global(article:last-child > .course-content-link) { border-bottom-left-radius: calc(var(--radius-lg) - 1px); border-bottom-right-radius: calc(var(--radius-lg) - 1px); }
    .items :global(article:last-child) { border-bottom: 0; }
</style>