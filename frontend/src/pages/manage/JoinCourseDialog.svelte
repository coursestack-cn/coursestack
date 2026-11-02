<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte.js";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import { type Course, type Term } from "./course";

    let { open = $bindable(false), onsaved, onclose }: { open?: boolean; onsaved: () => void; onclose?: () => void } = $props();
    let query = $state<string | number>("");
    let search = $state("");
    let page = $state(1);
    let pending = $state(false);
    let error = $state("");
    $effect(() => { if (open) error = ""; });
    const result = resource(async signal => {
        const viewer = session.user?.id, q = search, selectedPage = page;
        if (!open) return null;
        const terms = await api.get<Term[]>("/api/terms", { signal });
        const term = terms.find(t => t.current);
        if (!term) return { viewer, term: null, items: [], total: 0, page: selectedPage };
        const params = new URLSearchParams({ termId: term.id, q, page: String(selectedPage), pageSize: "10" });
        const data = await api.get<{ items: Course[]; total: number }>(`/api/courses?${params}`, { signal });
        return { ...data, viewer, term, page: selectedPage };
    });
    async function join(course: Course, term: Term) {
        pending = true; error = "";
        try {
            await api.put(`/api/courses/${encodeURIComponent(course.id)}/terms/${encodeURIComponent(term.id)}/teachers/me`);
            onsaved(); open = false;
        } catch (cause) { error = userMessage(cause, { OFFERING_UNAVAILABLE: "开课安排或当前学期已变化，请重新选择。" }); result.reload(); }
        finally { pending = false; }
    }
</script>

<Dialog bind:open title="加入课程" description="选择本学期已开设的课程，建立你自己的教学班。" dismissible={!pending} {onclose}>
    <div class="stack">
        <form class="search" onsubmit={event => { event.preventDefault(); search = String(query).trim(); page = 1; result.reload(); }}>
            <Field label="课程名称或课程号">{#snippet children({ id })}<TextInput {id} bind:value={query} maxlength={100} disabled={pending} />{/snippet}</Field>
            <Button type="submit" disabled={pending}>查找</Button>
        </form>
        <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
            {#if result.data?.viewer === session.user?.id && result.data}
                {#if result.data.term}
                    <p>{result.data.term.name}</p>
                    {#each result.data.items as course (course.id)}
                        {@const joined = course.currentTeachers.some(t => t.id === session.user?.id)}
                        <div class="row"><div><strong>{course.name}</strong><p>{course.id}</p></div>
                            <Button disabled={pending || joined} onclick={() => { if (result.data?.term) void join(course, result.data.term); }}>{joined ? "已加入" : "加入"}</Button></div>
                    {:else}<p>没有符合条件的已开设课程。</p>{/each}
                    <Pagination page={result.data.page} pageCount={Math.ceil(result.data.total / 10)} onchange={(next: number) => { page = next; }} />
                {:else}<p>尚未设置当前学期，请联系管理员。</p>{/if}
            {/if}
        </ResourceState>
        {#if error}<p class="error">{error}</p>{/if}
    </div>
</Dialog>

<style>
    .stack { display: grid; gap: var(--space-4); }
    .search, .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
    .search :global(.field) { flex: 1; }
    .row { padding-block: var(--space-3); border-bottom: 1px solid var(--color-border); }
    .row p { color: var(--color-text-secondary); }
    .error { color: var(--color-danger); }
</style>