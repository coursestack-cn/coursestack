<script lang="ts">
    import { untrack } from "svelte";
    import { Plus } from "@lucide/svelte";
    import type { PageProps } from "$lib/router/types";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { formatRelativeTime } from "$lib/content/relative-time";
    import { session } from "$lib/session.svelte.js";
    import { router, updateQuery } from "$lib/router/router.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import ManageNav from "./ManageNav.svelte";
    import JoinCourseDialog from "./JoinCourseDialog.svelte";
    import CourseTermsDialog from "./CourseTermsDialog.svelte";
    import CourseFormDialog from "./CourseFormDialog.svelte";
    import { courseClassesHref, type Course } from "./course";

    type CourseList = { items: Course[]; page: number; pageSize: number; total: number };
    type MyCourseList = Omit<CourseList, "items"> & { items: { course: Course }[] };
    let { params: _params }: PageProps = $props();
    const isAdmin = $derived(session.hasRole("admin"));
    const canManage = $derived(isAdmin || session.hasRole("teacher"));
    let query = $state<string | number>("");
    const activeQuery = $derived((router.query.get("q") ?? "").trim());
    const invalidQuery = $derived(activeQuery.length > 100);
    const createRequested = $derived(router.query.get("new") === "1");
    const page = $derived.by(() => {
        const value = Number(router.query.get("page") ?? 1);
        return Number.isSafeInteger(value) && value >= 1 && value <= 10000 ? value : 1;
    });
    $effect(() => { query = activeQuery; });

    const courses = resource(async (signal) => {
        const viewer = session.user?.id;
        if (!canManage || invalidQuery) return null;
        const search = new URLSearchParams({ page: String(page), pageSize: "20" });
        const keyword = activeQuery;
        if (keyword) search.set("q", keyword);
        let data: CourseList;
        if (isAdmin) data = await api.get<CourseList>(`/api/courses?${search}`, { signal });
        else {
            search.set("scope", "current");
            const mine = await api.get<MyCourseList>(`/api/me/courses?${search}`, { signal });
            data = { ...mine, items: mine.items.map(({ course }) => course) };
        }
        return { ...data, viewer, query: keyword };
    });

    $effect(() => {
        const data = courses.data;
        if (!data || courses.refreshing || data.viewer !== session.user?.id || data.query !== activeQuery || data.page !== page) return;
        const lastPage = Math.max(1, Math.min(10000, Math.ceil(data.total / data.pageSize)));
        if (page > lastPage) void updateQuery({ page: lastPage === 1 ? null : lastPage }, { replace: true });
    });

    let formOpen = $state(false);
    let termsOpen = $state(false);
    let joinOpen = $state(false);
    let selected = $state.raw<Course | null>(null);

    $effect(() => {
        const requested = createRequested;
        if (!canManage) return;
        untrack(() => {
            if (requested) { selected = null; if (isAdmin) formOpen = true; else joinOpen = true; }
            else if (!selected) { formOpen = false; joinOpen = false; }
        });
    });

    function closeCreate() {
        if (createRequested) void updateQuery({ new: null }, { replace: true });
    }

    function saved() {
        if (!selected) void updateQuery({ q: null, page: null, new: null }, { replace: true });
        courses.reload();
    }

    function search(event: SubmitEvent) {
        event.preventDefault();
        const next = String(query).trim();
        if (next.length > 100) return;
        if (next === activeQuery && page === 1) courses.reload();
        else void updateQuery({ q: next || null, page: null });
    }

    function teacherLabel(course: Course) {
        if (!course.offeredInCurrentTerm) return "本学期未开课";
        return course.currentTeachers.map(teacher => teacher.isDeleted ? "已删除" : teacher.nickname ?? "未设置昵称").join("、") || "尚无教师加入";
    }
</script>

<PageLayout title="课程管理" subtitle={isAdmin ? "维护课程信息、开课安排与各教师的教学班。" : "加入本学期已开设的课程，管理自己的教学班。"}>
    {#snippet actions()}
        {#if canManage}
            <Button variant="primary" onclick={() => { void updateQuery({ new: "1" }); }}>
                {#snippet icon()}<Plus size="1em" />{/snippet}
                {isAdmin ? "新建课程" : "加入课程"}
            </Button>
        {/if}
    {/snippet}
    {#if !canManage}
        <StateBlock kind="forbidden" description="需要教师或管理员身份才能管理课程。" />
    {:else}
        <ManageNav />
        <Card padding="lg">
            <form class="search" onsubmit={search}>
                <Field label="查找课程" help="支持课程名称或编号。">
                    {#snippet children({ id, describedBy, invalid })}
                        <TextInput {id} {invalid} aria-describedby={describedBy} type="search" clearable maxlength={100} bind:value={query} />
                    {/snippet}
                </Field>
                <Button type="submit" disabled={courses.status === "loading"}>搜索</Button>
            </form>
        </Card>
        {#if invalidQuery}
            <StateBlock kind="error" title="搜索关键词过长" description="最多输入 100 个字符，缩短关键词后重新搜索。" />
        {:else}
            <ResourceState status={courses.status} error={courses.error} refreshing={courses.refreshing} reload={courses.reload}>
                {#if courses.data?.viewer === session.user?.id && courses.data?.items.length}
                    <div class="table-scroll">
                        <table aria-label="课程列表">
                            <thead><tr><th>课程编号</th><th>课程名称</th><th>当前教师</th><th>更新时间</th><th>操作</th></tr></thead>
                            <tbody>
                                {#each courses.data.items as course (course.id)}
                                    {@const updated = formatRelativeTime(course.updatedAt)}
                                    <tr>
                                        <td>{course.id}</td>
                                        <td><Link href={`/courses/${encodeURIComponent(course.id)}`}>{course.name}</Link></td>
                                        <td class:muted={!course.currentTeachers.length}>{teacherLabel(course)}</td>
                                        <td><time datetime={updated.datetime} title={updated.title}>{updated.label}</time></td>
                                        <td><div class="row-actions">
                                            {#if isAdmin}
                                                <Button size="sm" onclick={() => { selected = course; formOpen = true; }}>编辑</Button>
                                                <Button size="sm" onclick={() => { selected = course; termsOpen = true; }}>开设学期</Button>
                                            {/if}
                                            <Button size="sm" href={courseClassesHref(course.id)}>教学班</Button>
                                        </div></td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                    <Pagination {page} pageCount={Math.ceil(courses.data.total / courses.data.pageSize)} onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }); }} />
                {:else if courses.data}
                    <StateBlock kind="empty" title={activeQuery ? "没有找到符合条件的课程" : isAdmin ? "还没有课程" : "本学期还没有任教的课程"} />
                {/if}
            </ResourceState>
        {/if}
    {/if}
</PageLayout>

{#if isAdmin}
    <CourseFormDialog bind:open={formOpen} course={selected} onsaved={saved} onfailed={courses.reload} onclose={closeCreate} />
    <CourseTermsDialog bind:open={termsOpen} course={selected} onsaved={courses.reload} />
{:else if canManage}
    <JoinCourseDialog bind:open={joinOpen} onsaved={saved} onclose={closeCreate} />
{/if}

<style>
    .search { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-4); }
    .search :global(.field) { flex: 1; min-width: min(100%, 16rem); }
    .table-scroll { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    table { width: 100%; border-collapse: collapse; text-align: left; background: var(--color-surface); }
    th, td { padding: var(--space-4); border-bottom: 1px solid var(--color-border); white-space: nowrap; }
    th { color: var(--color-text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
    tr:last-child td { border-bottom: 0; }
    .muted { color: var(--color-text-secondary); }
    .row-actions { display: flex; gap: var(--space-2); }
</style>