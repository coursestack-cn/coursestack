<script lang="ts">
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
    import AdminNav from "./AdminNav.svelte";
    import BonusPolicyDialog from "./BonusPolicyDialog.svelte";
    import CourseFormDialog from "./CourseFormDialog.svelte";
    import type { Course } from "./course";

    type CourseList = { items: Course[]; page: number; pageSize: number; total: number };
    let { params: _params }: PageProps = $props();
    let query = $state<string | number>("");
    const activeQuery = $derived(router.query.get("q") ?? "");
    const page = $derived.by(() => {
        const value = Number(router.query.get("page") ?? 1);
        return Number.isSafeInteger(value) && value > 0 ? value : 1;
    });
    $effect(() => { query = activeQuery; });

    const courses = resource((signal) => {
        const search = new URLSearchParams({ page: String(page), pageSize: "20" });
        if (activeQuery) search.set("q", activeQuery);
        return api.get<CourseList>(`/api/courses?${search}`, { signal });
    });

    let formOpen = $state(false);
    let policyOpen = $state(false);
    let selected = $state.raw<Course | null>(null);

    function openForm(course: Course | null) {
        selected = course;
        formOpen = true;
    }

    function search(event: SubmitEvent) {
        event.preventDefault();
        const next = String(query).trim();
        if (next === activeQuery && page === 1) courses.reload();
        else void updateQuery({ q: next || null, page: null });
    }

    function teacherLabel(teacher: Course["currentTeacher"]) {
        if (!teacher) return "本学期未开课";
        return teacher.isDeleted ? "已删除" : teacher.nickname ?? "未设置昵称";
    }
</script>

<PageLayout title="课程管理" subtitle="新建课程，维护课程信息和加分规则。">
    {#snippet actions()}
        {#if session.hasRole("admin")}<Button variant="primary" onclick={() => openForm(null)}>新建课程</Button>{/if}
    {/snippet}
    {#if !session.hasRole("admin")}
        <p role="alert">需要管理员权限才能管理课程。</p>
    {:else}
        <AdminNav />
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
        <ResourceState status={courses.status} error={courses.error} refreshing={courses.refreshing} reload={courses.reload}>
            {#if courses.data?.items.length}
                <div class="table-scroll">
                    <table>
                        <caption class="sr-only">课程列表</caption>
                        <thead><tr><th>课程编号</th><th>课程名称</th><th>当前教师</th><th>更新时间</th><th>操作</th></tr></thead>
                        <tbody>
                            {#each courses.data.items as course (course.id)}
                                {@const updated = formatRelativeTime(course.updatedAt)}
                                <tr>
                                    <td>{course.code}</td>
                                    <td><Link href={`/courses/${encodeURIComponent(course.code)}`}>{course.name}</Link></td>
                                    <td class:muted={!course.currentTeacher}>{teacherLabel(course.currentTeacher)}</td>
                                    <td><time datetime={updated.datetime} title={updated.title}>{updated.label}</time></td>
                                    <td><div class="row-actions">
                                        <Button size="sm" onclick={() => openForm(course)} aria-label={`编辑 ${course.code}`}>编辑</Button>
                                        <Button size="sm" onclick={() => { selected = course; policyOpen = true; }} aria-label={`设置 ${course.code} 的加分规则`}>加分规则</Button>
                                    </div></td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
                <Pagination {page} pageCount={Math.ceil(courses.data.total / courses.data.pageSize)} onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }); }} />
            {:else if courses.data}
                <p>{activeQuery ? "没有找到符合条件的课程。" : "还没有课程。"}</p>
            {/if}
        </ResourceState>
    {/if}
</PageLayout>

<CourseFormDialog bind:open={formOpen} course={selected} onsaved={courses.reload} onfailed={courses.reload} />
<BonusPolicyDialog bind:open={policyOpen} course={selected} onsaved={courses.reload} onfailed={courses.reload} />

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