<script lang="ts">
    import { api } from "$lib/api/client";
    import { userMessage } from "$lib/api/errors";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import { resource } from "$lib/api/resource.svelte.js";
    import { redirect, router, setTitle, updateQuery } from "$lib/router/router.svelte.js";
    import type { PageProps } from "$lib/router/types";
    import { session } from "$lib/session.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import ManageNav from "./ManageNav.svelte";
    import { classUrl, classStudentsHref, courseManageHref, pageCount, pageNumber, teacherLabel, type Course, type Page, type TeachingClass, type Term } from "./course";

    let { params }: PageProps = $props();
    const isAdmin = $derived(session.hasRole("admin"));
    const canManage = $derived(isAdmin || session.hasRole("teacher"));
    const termId = $derived(router.query.get("termId") ?? "");
    const page = $derived(pageNumber(router.query.get("page")));
    const entry = resource(async signal => {
        const viewer = session.user?.id, code = encodeURIComponent(params.courseCode);
        if (!canManage) return null;
        const [data, terms] = await Promise.all([
            api.get<{ course: Course }>(`/api/courses/${code}/entry`, { signal }),
            isAdmin ? api.get<Term[]>(`/api/courses/${code}/terms`, { signal }) : Promise.resolve<Term[]>([])
        ]);
        return { course: data.course, terms, viewer };
    });
    const course = $derived(entry.data?.viewer === session.user?.id ? entry.data?.course : undefined);
    const terms = $derived(entry.data?.viewer === session.user?.id ? entry.data?.terms ?? [] : []);
    // Course, term and teacher identify a class, so a teacher has at most one here and opens it directly; the list is for administrators.
    const teaching = $derived(!isAdmin && course?.currentTerm != null && course.currentTeachers.some(teacher => teacher.id === session.user?.id));
    const options = $derived([
        { value: "", label: "全部学期" },
        ...terms.map(term => ({ value: term.id, label: `${term.name}${term.current ? "（当前学期）" : ""}` })),
        ...(termId && !terms.some(term => term.id === termId) ? [{ value: termId, label: `${termId}（未开设）` }] : [])
    ]);
    const classes = resource(async signal => {
        const viewer = session.user?.id, selectedTerm = termId, currentPage = page, courseId = params.courseCode;
        if (!isAdmin || !course) return null;
        const query = new URLSearchParams({ courseId, page: String(currentPage), pageSize: "20" });
        if (selectedTerm) query.set("termId", selectedTerm);
        const data = await api.get<Page<TeachingClass>>(`/api/teaching-classes?${query}`, { signal });
        return { ...data, viewer, termId: selectedTerm };
    });

    let removing = $state.raw<TeachingClass | null>(null);
    let removeOpen = $state(false), removeError = $state("");

    function confirmRemoval(value: TeachingClass) {
        removing = value; removeError = ""; removeOpen = true;
    }

    async function removeClass() {
        if (!removing) return;
        await api.delete(classUrl(removing));
        toast.success("教学班已删除");
        classes.reload();
    }

    $effect(() => { if (course) setTitle(`${course.name} · 教学班列表`); });
    $effect(() => { if (teaching && course) redirect(courseManageHref(course, session.user)); });
    $effect(() => {
        const data = classes.data;
        if (!data || classes.refreshing || data.viewer !== session.user?.id || data.termId !== termId || data.page !== page) return;
        const lastPage = pageCount(data);
        if (page > lastPage) void updateQuery({ page: lastPage === 1 ? null : lastPage }, { replace: true });
    });
</script>

<PageLayout title={course?.name ?? "教学班列表"} subtitle={course ? `课程号 ${course.id}` : undefined} loading={canManage && entry.status === "loading"}
    breadcrumbs={[{ label: "课程管理", href: "/manage/courses" }, { label: course?.name ?? params.courseCode }]}>
    {#snippet actions()}<Button href={`/courses/${encodeURIComponent(params.courseCode)}`}>课程主页</Button>{/snippet}
    {#if !canManage}
        <StateBlock kind="forbidden" description="需要教师或管理员身份才能管理教学班。" />
    {:else if !isAdmin}
        <ResourceState status={entry.status} error={entry.error} refreshing={entry.refreshing} reload={entry.reload}>
            {#if course && !teaching}<StateBlock kind="empty" title={course.currentTerm ? "你本学期没有任教这门课程" : "尚未设置当前学期"} />{/if}
        </ResourceState>
    {:else}
        <ManageNav />
        <ResourceState status={entry.status} error={entry.error} refreshing={entry.refreshing} reload={entry.reload}>
            {#if course}
                <div class="filter">
                    <Field label="学期">
                        {#snippet children({ id })}
                            <Select {id} {options} value={termId} onchange={event => { void updateQuery({ termId: event.currentTarget.value || null, page: null }); }} />
                        {/snippet}
                    </Field>
                </div>
                <ResourceState status={classes.status} error={classes.error} refreshing={classes.refreshing} reload={classes.reload}>
                    {#if classes.data?.viewer === session.user?.id && classes.data}
                        {#if classes.data.items.length}
                            <p class="hint">共 {classes.data.total} 个教学班</p>
                            <div class="table-scroll">
                                <table aria-label="教学班列表">
                                    <thead><tr><th scope="col">学期</th><th scope="col">教师</th><th scope="col">学生人数</th><th scope="col">操作</th></tr></thead>
                                    <tbody>
                                        {#each classes.data.items as value (`${value.termId}:${value.teacherId}`)}
                                            <tr>
                                                <td>{value.term.name}{value.term.current ? "（当前学期）" : ""}</td>
                                                <td>{teacherLabel(value.teacher)}</td>
                                                <td>{value.studentCount}</td>
                                                <td><div class="row-actions">
                                                    <Button size="sm" href={classStudentsHref(value)}>学生名单</Button>
                                                    <Button size="sm" disabled={classes.refreshing} onclick={() => confirmRemoval(value)}>删除教学班</Button>
                                                </div></td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                            <Pagination {page} pageCount={pageCount(classes.data)} disabled={classes.refreshing} aria-label="教学班列表分页"
                                onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }, { scroll: "top" }); }} />
                        {:else}
                            <StateBlock kind="empty" title={termId ? "该学期暂无教学班" : "暂无可管理的教学班"}>
                                {#snippet actions()}
                                    {#if termId}<Button onclick={() => { void updateQuery({ termId: null, page: null }); }}>查看全部学期</Button>{/if}
                                {/snippet}
                            </StateBlock>
                        {/if}
                    {/if}
                </ResourceState>
            {/if}
        </ResourceState>
    {/if}
</PageLayout>

{#if isAdmin && removing}
    <ConfirmDialog bind:open={removeOpen} danger title="删除教学班？"
        description={`${removing.course.name} · ${removing.term.name} · ${teacherLabel(removing.teacher)}。仍在本班的学生将失去此次修读记录和全部积分。需要保留的学生请先转班。`}
        confirmLabel="删除教学班" onconfirm={removeClass} onclose={() => { removing = null; }}
        onerror={cause => { removeError = userMessage(cause); classes.reload(); }}>
        {#if removeError}<p role="alert">{removeError}</p>{/if}
    </ConfirmDialog>
{/if}

<style>
    .row-actions { display: flex; gap: var(--space-2); }
    [role="alert"] { color: var(--color-danger); }
    .filter { width: min(100%, 20rem); }
    .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .table-scroll { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    table { width: 100%; border-collapse: collapse; text-align: left; background: var(--color-surface); }
    th, td { padding: var(--space-4); border-bottom: 1px solid var(--color-border); white-space: nowrap; }
    th { color: var(--color-text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
    tr:last-child td { border-bottom: 0; }
</style>