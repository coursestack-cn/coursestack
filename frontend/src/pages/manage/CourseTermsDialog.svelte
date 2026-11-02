<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { userMessage } from "$lib/api/errors";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import { type Course, type Term } from "./course";

    let { open = $bindable(false), course, onsaved }: { open?: boolean; course: Course | null; onsaved: () => void } = $props();
    let termId = $state("");
    let pending = $state(false);
    let error = $state("");
    $effect(() => { if (open) { course?.id; termId = ""; error = ""; } });
    const result = resource(async signal => {
        if (!open || !course) return null;
        const [terms, offerings] = await Promise.all([api.get<Term[]>("/api/terms", { signal }),
            api.get<Term[]>(`/api/courses/${encodeURIComponent(course.id)}/terms`, { signal })]);
        return { terms, offerings };
    });
    const options = $derived([{ value: "", label: "选择学期", disabled: true }, ...(result.data?.terms ?? [])
        .filter(term => !result.data?.offerings.some(o => o.id === term.id)).map(t => ({ value: t.id, label: `${t.name}${t.current ? "（当前学期）" : ""}` }))]);
    async function change(id: string, remove = false) {
        if (!course || !id || pending) return;
        pending = true; error = "";
        try {
            const url = `/api/courses/${encodeURIComponent(course.id)}/terms/${encodeURIComponent(id)}`;
            if (remove) await api.delete(url); else await api.put(url);
            termId = ""; result.reload(); onsaved();
        } catch (cause) { error = userMessage(cause, { REFERENCE_CONFLICT: "已有教师加入的开课安排不能撤销。" }); }
        finally { pending = false; }
    }
</script>

<Dialog bind:open title="开设学期" description={course?.name} dismissible={!pending}>
    <div class="stack">
        <p>安排开课后，教师可在该学期成为当前学期时自行加入。</p>
        <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
            {#each result.data?.offerings ?? [] as term (term.id)}
                <div class="row"><span>{term.name}{term.current ? "（当前学期）" : ""}</span><Button size="sm" disabled={pending} onclick={() => change(term.id, true)}>撤销安排</Button></div>
            {:else}<p>尚未安排开设学期。</p>{/each}
            <Field label="安排开课">{#snippet children({ id })}<Select {id} {options} bind:value={termId} disabled={pending} />{/snippet}</Field>
            <Button variant="primary" disabled={!termId || pending} onclick={() => change(termId)}>添加开课安排</Button>
        </ResourceState>
        {#if error}<p class="error">{error}</p>{/if}
    </div>
</Dialog>

<style>
    .stack { display: grid; gap: var(--space-4); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
    .error { color: var(--color-danger); }
</style>