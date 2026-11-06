<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import SearchInput from "$lib/components/ui/SearchInput.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";

    let { value, onchange, id }: { value: string; onchange: (course: string) => void; id: string } = $props();
    type Course = { id: string; name: string };
    type Page = { items: Course[]; page: number; pageSize: number; total: number };
    let open = $state(false), input = $state(""), query = $state(""), page = $state(1);
    const selected = resource(async signal => value
        ? { id: value, data: await api.get<Page>(`/api/courses?${new URLSearchParams({ id: value, pageSize: "1" })}`, { signal }) } : null);
    const label = $derived(value ? selected.data?.id === value ? selected.data.data.items[0]?.name ?? value : value : "全部课程");
    const courses = resource(async signal => {
        if (!open) return null;
        const key = `${query}:${page}`;
        const data = await api.get<Page>(`/api/courses?${new URLSearchParams({ q: query, page: String(page), pageSize: "20" })}`, { signal });
        return { ...data, key };
    });
    function search() { query = input.trim(); page = 1; courses.reload(); }
    function select(course: string) { onchange(course); open = false; }
    $effect(() => {
        const data = courses.data;
        if (data && data.key === `${query}:${page}` && !courses.refreshing && page > Math.max(1, Math.ceil(data.total / 20))) {
            page = Math.max(1, Math.ceil(data.total / 20));
        }
    });
</script>

<Button {id} onclick={() => { input = ""; query = ""; page = 1; open = true; }}>{label}</Button>
<Dialog bind:open title="选择课程">
    <form class="search" onsubmit={event => { event.preventDefault(); search(); }}>
        <SearchInput bind:value={input} maxlength={100} aria-label="查找课程名称或编号" placeholder="课程名称或编号" onsubmit={search} onclear={search} />
        <Button type="submit">查找</Button>
    </form>
    <Button variant="ghost" onclick={() => select("")}>全部课程</Button>
    <ResourceState status={courses.status} error={courses.error} refreshing={courses.refreshing} reload={courses.reload}>
        {#if courses.data}
            {#if courses.data.items.length}
                <ul>{#each courses.data.items as course (course.id)}<li>
                    <Button variant="ghost" class="course-option" aria-pressed={course.id === value} onclick={() => select(course.id)}>
                        <span>{course.name}</span><span>{course.id}</span>
                    </Button>
                </li>{/each}</ul>
                {#if courses.data.total > 20}<Pagination {page} pageCount={Math.ceil(courses.data.total / 20)} disabled={courses.refreshing} onchange={(next: number) => { page = next; }} />{/if}
            {:else}<StateBlock kind="empty" title="没有找到课程" description="试试课程名称或课程号。" />{/if}
        {/if}
    </ResourceState>
</Dialog>

<style>
    .search { display: flex; gap: var(--space-2); margin-bottom: var(--space-3); }
    ul { list-style: none; padding: 0; display: grid; margin-block: var(--space-3); }
    li { min-width: 0; }
    li :global(.course-option) { width: 100%; gap: var(--space-2); flex-wrap: wrap; justify-content: flex-start; text-align: left; height: auto; white-space: normal; overflow-wrap: anywhere; }
</style>