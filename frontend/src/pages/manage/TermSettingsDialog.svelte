<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { userMessage } from "$lib/api/errors";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import { type Term } from "./course";

    let { open = $bindable(false), onsaved }: { open?: boolean; onsaved: () => void } = $props();
    let termId = $state<string | number>("");
    let name = $state<string | number>("");
    let pending = $state(false);
    let error = $state("");
    $effect(() => { if (open) error = ""; });
    const result = resource(signal => open ? api.get<Term[]>("/api/terms", { signal }) : Promise.resolve([]));
    async function save(current?: string | null) {
        if (pending) return;
        pending = true; error = "";
        try {
            if (current !== undefined) await api.put("/api/terms/current", { termId: current });
            else {
                const id = String(termId).trim(), label = String(name).trim();
                if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || id === "current" || !label) { error = "请输入有效的学期编号和名称，编号可用字母、数字、下划线或短横线。"; return; }
                await api.put(`/api/terms/${encodeURIComponent(id)}`, { name: label });
                termId = ""; name = "";
            }
            result.reload(); onsaved();
        } catch (cause) { error = userMessage(cause); }
        finally { pending = false; }
    }
</script>

<Dialog bind:open title="学期设置" dismissible={!pending}>
    <div class="stack">
        <p>切换当前学期后，教师的内容管理和教学班权限随之切换，历史资料与积分保留。</p>
        <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
            {#each result.data ?? [] as term (term.id)}
                <div class="row"><div>{term.name}<small>{term.id}</small></div><Button size="sm" disabled={pending || term.current} onclick={() => save(term.id)}>{term.current ? "当前学期" : "设为当前"}</Button></div>
            {/each}
            {#if result.data?.some(t => t.current)}<Button disabled={pending} onclick={() => save(null)}>清除当前学期</Button>{/if}
        </ResourceState>
        <form class="stack" onsubmit={event => { event.preventDefault(); void save(); }}>
            <Field label="学期编号" help="如 2026-fall。填写已有编号可以更新该学期名称。">{#snippet children({ id })}<TextInput {id} bind:value={termId} maxlength={100} disabled={pending} />{/snippet}</Field>
            <Field label="学期名称">{#snippet children({ id })}<TextInput {id} bind:value={name} maxlength={120} disabled={pending} />{/snippet}</Field>
            <Button type="submit" variant="primary" disabled={pending || !String(termId).trim() || !String(name).trim()}>保存学期</Button>
        </form>
        {#if error}<p class="error">{error}</p>{/if}
    </div>
</Dialog>

<style>
    .stack { display: grid; gap: var(--space-4); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
    small { display: block; color: var(--color-text-secondary); }
    .error { color: var(--color-danger); }
</style>