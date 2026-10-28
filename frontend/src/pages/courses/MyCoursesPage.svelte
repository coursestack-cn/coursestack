<script lang="ts">
    import { ArrowRight, BookOpen, CalendarDays, Plus, UserRound } from "@lucide/svelte";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { displayName } from "$lib/content/display-name";
    import { router, updateQuery } from "$lib/router/router.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import Tabs from "$lib/components/ui/Tabs.svelte";

    type Term = { id: string; name: string; current: boolean };
    type MyCourse = {
        course: {
            id: string;
            name: string;
            code: string;
            introduction: string;
            currentTeacher: { id: string; nickname: string | null; isDeleted: boolean } | null;
        };
        terms: Term[];
    };
    type MyCourseList = {
        items: MyCourse[];
        page: number;
        pageSize: number;
        total: number;
        scope: "current" | "history";
        currentTerm: { id: string; name: string } | null;
    };

    const tabs = [{ value: "current", label: "本学期" }, { value: "history", label: "历年" }];
    const scope = $derived(router.query.get("tab") === "history" ? "history" : "current");
    const page = $derived.by(() => {
        const value = Number(router.query.get("page") ?? 1);
        return Number.isInteger(value) && value >= 1 && value <= 10000 ? value : 1;
    });
    const canCreate = $derived(session.hasRole("teacher") || session.hasRole("admin"));
    const relation = $derived(session.hasRole("teacher") ? "授课" : session.hasRole("student") ? "修读" : "参与");
    const courses = resource((signal) => {
        const query = new URLSearchParams({ scope, page: String(page), pageSize: "12" });
        return api.get<MyCourseList>(`/api/me/courses?${query}`, { signal });
    });
    const status = $derived(courses.data && courses.data.scope !== scope ? "loading" : courses.status);

    $effect(() => {
        const data = courses.data;
        if (!data || courses.refreshing || data.scope !== scope || data.page !== page) return;
        const lastPage = Math.max(1, Math.min(10000, Math.ceil(data.total / data.pageSize)));
        if (page > lastPage) void updateQuery({ page: lastPage === 1 ? null : lastPage }, { replace: true });
    });
</script>

<PageLayout title="我的课程与动态">
    {#snippet actions()}
        <Button href="/courses">全部课程</Button>
        {#if canCreate}
            <Button href="/courses/new" variant="primary">
                {#snippet icon()}<Plus size="1em" />{/snippet}
                新建课程
            </Button>
        {/if}
    {/snippet}

    <Tabs items={tabs} value={scope} label="我的课程" onchange={(next) => { void updateQuery({ tab: next === "current" ? null : next, page: null }); }}>
        <ResourceState {status} error={courses.error} refreshing={courses.refreshing} reload={courses.reload}>
            {#if courses.data && courses.data.scope === scope}
                {@const data = courses.data}
                <div class="list-summary">
                    <p>
                        {#if scope === "current" && data.currentTerm}<span class="term-name">{data.currentTerm.name}</span> · {/if}
                        {scope === "current" ? `我${relation}的课程` : `我${relation}过的课程`}
                    </p>
                    <p role="status" aria-live="polite">共 <strong>{data.total}</strong> 门课程</p>
                </div>

                {#if data.items.length}
                    <ul class="course-grid" aria-label={scope === "current" ? "本学期课程" : "历年课程"}>
                        {#each data.items as item (item.course.id)}
                            {@const course = item.course}
                            <li>
                                <Card href={`/courses/${encodeURIComponent(course.code)}`} padding="lg" class="my-course-card" aria-label={`查看课程：${course.name}`}>
                                    <div class="course-content">
                                        <div class="course-code"><BookOpen size="1.25em" aria-hidden="true" /><span>{course.code}</span></div>
                                        <h2>{course.name}</h2>
                                        <p class="introduction" class:muted={!course.introduction.trim()}>{course.introduction.trim() || "暂无课程简介"}</p>
                                        <div class="course-footer">
                                            {#if scope === "current"}
                                                <div class="detail">
                                                    <UserRound size="1em" aria-hidden="true" />
                                                    <span><span class="detail-label">本学期教师</span>{course.currentTeacher ? displayName(course.currentTeacher) : "暂无教师信息"}</span>
                                                </div>
                                            {:else}
                                                <div class="detail">
                                                    <CalendarDays size="1em" aria-hidden="true" />
                                                    <span>{item.terms.map(term => term.name).join("、")}</span>
                                                </div>
                                            {/if}
                                            <ArrowRight size="1em" aria-hidden="true" />
                                        </div>
                                    </div>
                                </Card>
                            </li>
                        {/each}
                    </ul>
                    {#if data.total > data.pageSize}
                        <div class="list-footer">
                            <p>第 {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} 门，共 {data.total} 门</p>
                            <Pagination page={data.page} pageCount={Math.min(10000, Math.ceil(data.total / data.pageSize))} disabled={courses.refreshing}
                                onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }, { scroll: "top" }); }} />
                        </div>
                    {/if}
                {:else if data.total > 0}
                    <StateBlock kind="loading" title="正在调整页码" />
                {:else if scope === "current" && !data.currentTerm}
                    <StateBlock kind="empty" title="当前学期尚未设置" description="可以先查看历年课程，或浏览全部课程。">
                        {#snippet icon()}<CalendarDays size="1em" />{/snippet}
                        {#snippet actions()}<Button onclick={() => { void updateQuery({ tab: "history", page: null }); }}>查看历年课程</Button>{/snippet}
                    </StateBlock>
                {:else}
                    <StateBlock kind="empty" title={scope === "current" ? "本学期暂无课程" : "暂无历年课程"}
                        description={session.hasRole("admin") ? "这里显示本人的授课与修读记录。可以前往全部课程浏览和管理课程。"
                            : scope === "history" ? `以往${relation}的课程会显示在这里。`
                            : session.hasRole("teacher") ? "创建课程后会显示在这里。" : "加入本学期修读名单后，课程会显示在这里。也可以先浏览全部课程。"}>
                        {#snippet icon()}<BookOpen size="1em" />{/snippet}
                        {#snippet actions()}<Button href="/courses">浏览全部课程</Button>{/snippet}
                    </StateBlock>
                {/if}
            {/if}
        </ResourceState>
    </Tabs>
</PageLayout>

<style>
    .list-summary, .list-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .list-summary p { min-width: 0; overflow-wrap: anywhere; }
    .list-summary strong, .term-name { color: var(--color-text); }
    .course-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-5); list-style: none; padding: 0; }
    .course-grid li { min-width: 0; }
    .course-grid :global(.my-course-card) { height: 100%; }
    .course-content { display: flex; flex-direction: column; gap: var(--space-3); height: 100%; }
    .course-code { display: flex; align-items: flex-start; gap: var(--space-2); color: var(--color-text-secondary); font-family: var(--font-mono); font-size: var(--font-size-sm); }
    .course-code :global(svg) { flex-shrink: 0; margin-top: var(--space-1); color: var(--color-accent); }
    h2 { font-size: var(--font-size-lg); }
    .introduction { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; min-height: calc(3 * var(--line-height-base) * var(--font-size-md)); color: var(--color-text-secondary); font-size: var(--font-size-md); white-space: pre-line; }
    .muted { color: var(--color-text-muted); }
    .course-footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: auto; padding-top: var(--space-4); border-top: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .course-footer :global(svg) { flex-shrink: 0; }
    .detail { display: flex; align-items: flex-start; gap: var(--space-2); min-width: 0; }
    .detail :global(svg) { margin-top: var(--space-1); }
    .detail-label { margin-inline-end: var(--space-2); }
    @media (max-width: 1023px) { .course-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 639px) { .course-grid { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); } .list-footer { justify-content: center; } }
</style>