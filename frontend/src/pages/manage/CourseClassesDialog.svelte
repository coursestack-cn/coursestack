<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import ClassDetails from "./ClassDetails.svelte";
    import { type Course, type TeachingClass } from "./course";

    let { open = $bindable(false), course }: { open?: boolean; course: Course | null } = $props();
    let page = $state(1);
    let pending = $state(false);
    let selected = $state.raw<TeachingClass | null>(null);
    $effect(() => { if (!open) { selected = null; page = 1; } });
    const result = resource(async signal => {
        const viewer = session.user?.id;
        if (!open || !course) return null;
        const search = new URLSearchParams({ courseId: course.id, page: String(page), pageSize: "10" });
        const data = await api.get<{ items: TeachingClass[]; page: number; total: number }>(`/api/teaching-classes?${search}`, { signal });
        return { ...data, viewer };
    });
</script>

<Dialog bind:open title="教学班" description={course ? `${course.id} ${course.name}` : undefined} dismissible={!pending}>
    {#if open && selected}
        <ClassDetails value={selected} bind:pending onback={() => { selected = null; result.reload(); }} />
    {:else}
        <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
            {#if result.data?.viewer === session.user?.id}
                <div class="stack">
                    {#each result.data?.items ?? [] as value (`${value.termId}:${value.teacherId}`)}
                        <div class="row"><div><strong>{value.teacher.nickname ?? "未设置昵称"}</strong><p>{value.term.name}{value.term.current ? "（当前学期）" : ""}，{value.studentCount} 位学生</p></div>
                            <Button onclick={() => { selected = value; }}>管理教学班</Button></div>
                    {:else}<p>尚无可管理的教学班。</p>{/each}
                </div>
                {#if result.data}<Pagination page={result.data.page} pageCount={Math.ceil(result.data.total / 10)} onchange={(next: number) => { page = next; }} />{/if}
            {/if}
        </ResourceState>
    {/if}
</Dialog>

<style>
    .stack { display: grid; gap: var(--space-4); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding-block: var(--space-3); }
    .row p { color: var(--color-text-secondary); }
</style>