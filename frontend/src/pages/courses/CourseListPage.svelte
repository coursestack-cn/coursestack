<script lang="ts">
    import { ArrowRight, BookOpen, Plus, UserRound } from "@lucide/svelte";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { displayName } from "$lib/content/display-name";
    import { router, updateQuery } from "$lib/router/router.svelte.js";
    import type { PageProps } from "$lib/router/types";
    import { session } from "$lib/session.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import SearchInput from "$lib/components/ui/SearchInput.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";

    type Course = {
        id: string;
        name: string;
        code: string;
        introduction: string;
        currentTeacher: { id: string; nickname: string | null; isDeleted: boolean } | null;
    };
    type CourseList = { items: Course[]; page: number; pageSize: number; total: number };

    let { params: _params }: PageProps = $props();
    let query = $state("");
    const activeQuery = $derived((router.query.get("q") ?? "").trim());
    const invalidQuery = $derived(activeQuery.length > 100);
    const page = $derived.by(() => {
        const value = Number(router.query.get("page") ?? 1);
        return Number.isInteger(value) && value >= 1 && value <= 10000 ? value : 1;
    });
    const canCreate = $derived(session.hasRole("teacher") || session.hasRole("admin"));
    const courses = resource(async (signal) => {
        const keyword = activeQuery;
        const search = new URLSearchParams({ page: String(page), pageSize: "12" });
        if (keyword.length > 100) return null;
        if (keyword) search.set("q", keyword);
        const data = await api.get<CourseList>(`/api/courses?${search}`, { signal });
        return { ...data, query: keyword };
    });

    $effect(() => { query = activeQuery; });

    $effect(() => {
        const data = courses.data;
        if (!data || courses.refreshing || data.query !== activeQuery || data.page !== page) return;
        const lastPage = Math.max(1, Math.min(10000, Math.ceil(data.total / data.pageSize)));
        if (page > lastPage) void updateQuery({ page: lastPage === 1 ? null : lastPage }, { replace: true });
    });

    function search(value: string) {
        const keyword = value.trim();
        if (keyword.length > 100) return;
        query = keyword;
        if (keyword === activeQuery && page === 1) courses.reload();
        else void updateQuery({ q: keyword || null, page: null }, { scroll: "top" });
    }
</script>

<PageLayout title="全部课程" subtitle="浏览课程，查找资料与问答。">
    {#snippet actions()}
        {#if canCreate}
            <Button href="/courses/new" variant="primary">
                {#snippet icon()}<Plus size="1em" />{/snippet}
                新建课程
            </Button>
        {/if}
    {/snippet}

    <form class="search-form" role="search" aria-label="课程搜索" onsubmit={(event) => { event.preventDefault(); search(query); }}>
        <SearchInput bind:value={query} aria-label="搜索课程" placeholder="搜索课程名称或编号" maxlength={100}
            invalid={query.trim().length > 100} onsubmit={search} onclear={() => search("")} />
        <Button type="submit" variant="primary">搜索</Button>
    </form>

    {#if invalidQuery}
        <StateBlock kind="error" title="搜索关键词过长" description="最多输入 100 个字符，缩短关键词后重新搜索。" />
    {:else}
        <ResourceState status={courses.status} error={courses.error} refreshing={courses.refreshing} reload={courses.reload}>
            {#if courses.data}
                {@const data = courses.data}
                <div class="list-summary">
                    <p role="status" aria-live="polite">
                        {#if data.query}<span class="keyword">“{data.query}”</span> 的搜索结果 · {/if}
                        共 <strong>{data.total}</strong> 门课程
                    </p>
                    {#if data.total > 0}<span class="sort-label">最新创建</span>{/if}
                </div>

                {#if data.items.length}
                    <ul class="course-grid" aria-label="课程列表">
                        {#each data.items as course (course.id)}
                            <li>
                                <Card href={`/courses/${encodeURIComponent(course.code)}`} padding="lg" class="course-card" aria-label={`查看课程：${course.name}`}>
                                    <div class="course-content">
                                        <div class="course-code">
                                            <BookOpen size="1.25em" aria-hidden="true" />
                                            <span>{course.code}</span>
                                        </div>
                                        <h2>{course.name}</h2>
                                        <p class="introduction" class:muted={!course.introduction.trim()}>{course.introduction.trim() || "暂无课程简介"}</p>
                                        <div class="course-footer">
                                            <div class="teacher">
                                                <UserRound size="1em" aria-hidden="true" />
                                                <span>
                                                    {#if course.currentTeacher}
                                                        <span class="teacher-label">本学期教师</span>
                                                        {displayName(course.currentTeacher)}
                                                    {:else}本学期未开课{/if}
                                                </span>
                                            </div>
                                            <ArrowRight size="1em" aria-hidden="true" />
                                        </div>
                                    </div>
                                </Card>
                            </li>
                        {/each}
                    </ul>

                    <div class="list-footer">
                        <p>第 {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} 门，共 {data.total} 门</p>
                        {#if data.total > data.pageSize}
                            <Pagination page={data.page} pageCount={Math.min(10000, Math.ceil(data.total / data.pageSize))} disabled={courses.refreshing}
                                onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }, { scroll: "top" }); }} />
                        {/if}
                    </div>
                {:else if data.total > 0}
                    <StateBlock kind="loading" title="正在调整页码" />
                {:else if data.query}
                    <StateBlock kind="empty" title="没有找到相关课程" description="试试其他课程名称或编号，也可以清除搜索查看全部课程。">
                        {#snippet actions()}<Button onclick={() => search("")}>查看全部课程</Button>{/snippet}
                    </StateBlock>
                {:else}
                    <StateBlock kind="empty" title="暂无课程" description={canCreate ? "创建第一门课程，开始整理资料与问答。" : "课程创建后会显示在这里。"}>
                        {#snippet icon()}<BookOpen size="1em" />{/snippet}
                    </StateBlock>
                {/if}
            {/if}
        </ResourceState>
    {/if}
</PageLayout>

<style>
    .search-form { display: flex; align-items: flex-start; gap: var(--space-3); max-width: var(--width-prose); }
    .search-form :global(.search) { flex: 1; }
    .search-form :global(.cs-button[type="submit"]) { flex-shrink: 0; }
    .list-summary, .list-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .list-summary p { min-width: 0; overflow-wrap: anywhere; }
    .list-summary strong { color: var(--color-text); }
    .keyword { color: var(--color-text); }
    .sort-label { flex-shrink: 0; }
    .course-grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-5); }
    .course-grid li { min-width: 0; }
    .course-grid :global(.course-card) { height: 100%; }
    .course-content { display: flex; flex-direction: column; gap: var(--space-3); height: 100%; }
    .course-code { display: flex; align-items: flex-start; gap: var(--space-2); color: var(--color-text-secondary); font-family: var(--font-mono); font-size: var(--font-size-sm); }
    .course-code :global(svg) { flex-shrink: 0; margin-top: var(--space-1); color: var(--color-accent); }
    h2 { font-size: var(--font-size-lg); }
    .introduction { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; min-height: calc(3 * var(--line-height-base) * var(--font-size-md)); color: var(--color-text-secondary); font-size: var(--font-size-md); white-space: pre-line; }
    .muted { color: var(--color-text-muted); }
    .course-footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: auto; padding-top: var(--space-4); border-top: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .course-footer :global(svg) { flex-shrink: 0; }
    .teacher { display: flex; align-items: flex-start; gap: var(--space-2); min-width: 0; }
    .teacher :global(svg) { margin-top: var(--space-1); }
    .teacher-label { margin-inline-end: var(--space-2); }
    @media (max-width: 1023px) { .course-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 639px) { .course-grid { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); } .list-footer { justify-content: center; } }
</style>