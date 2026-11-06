<script lang="ts">
    import { onDestroy } from "svelte";
    import { Plus } from "@lucide/svelte";
    import type { PageProps } from "$lib/router/types";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import ManageNav from "./ManageNav.svelte";
    import type { Term } from "./course";

    let { params: _params }: PageProps = $props();
    const isAdmin = $derived(session.hasRole("admin"));
    const terms = resource(async signal => {
        const viewer = session.user?.id;
        if (!isAdmin) return null;
        return { viewer, items: await api.get<Term[]>("/api/terms", { signal }) };
    });
    const items = $derived(terms.data?.viewer === session.user?.id ? terms.data?.items : undefined);
    const current = $derived(items?.find(term => term.current));
    let pending = $state(false);
    const busy = $derived(pending || terms.refreshing || !items);
    let actionError = $state("");
    let formOpen = $state(false);
    let selected = $state.raw<Term | null>(null);
    let termId = $state<string | number>("");
    let name = $state<string | number>("");
    let idError = $state("");
    let nameError = $state("");
    let formError = $state("");
    const changed = $derived(String(termId).trim() !== (selected?.id ?? "") || String(name).trim() !== (selected?.name ?? ""));
    let alive = true;
    onDestroy(() => { alive = false; });
    onBeforeLeave(() => !pending && !(formOpen && changed));

    function openForm(term: Term | null = null) {
        selected = term; termId = term?.id ?? ""; name = term?.name ?? "";
        idError = ""; nameError = ""; formError = ""; formOpen = true;
    }

    async function save(event: SubmitEvent) {
        event.preventDefault();
        if (busy || !isAdmin || !changed) return;
        const id = String(termId).trim(), label = String(name).trim();
        idError = !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || id === "current"
            ? "编号限 1–100 个字母、数字、下划线或短横线，不能使用 current。"
            : !selected && items?.some(term => term.id === id) ? "该学期编号已存在，请在列表中选择重命名。" : "";
        nameError = !label || label.length > 120 ? "请输入 1–120 个字符的学期名称。" : "";
        formError = "";
        if (idError || nameError) return;
        const viewer = session.user?.id;
        pending = true;
        try {
            await api.put(`/api/terms/${encodeURIComponent(id)}`, { name: label });
            if (!alive || viewer !== session.user?.id) return;
            toast.success(selected ? "已重命名学期" : "已创建学期");
            formOpen = false; terms.reload();
        } catch (cause) {
            if (!alive || viewer !== session.user?.id) return;
            formError = userMessage(cause, { INVALID_TERM_ID: "学期编号无效，请检查后重试。" });
            terms.reload();
        } finally { if (alive && viewer === session.user?.id) pending = false; }
    }

    async function setCurrent(id: string | null) {
        if (busy || !isAdmin) return;
        const viewer = session.user?.id;
        pending = true; actionError = "";
        try {
            await api.put("/api/terms/current", { termId: id });
            if (!alive || viewer !== session.user?.id) return;
            toast.success(id === null ? "已清除当前学期" : "已切换当前学期");
            terms.reload();
        } catch (cause) {
            if (!alive || viewer !== session.user?.id) return;
            actionError = userMessage(cause, { TERM_NOT_FOUND: "该学期已不存在，请刷新列表后重试。" });
            terms.reload();
        } finally { if (alive && viewer === session.user?.id) pending = false; }
    }
</script>

<PageLayout title="学期设置" subtitle="维护全站学期，设置当前学期。">
    {#snippet actions()}
        {#if isAdmin}
            <Button variant="primary" disabled={busy} onclick={() => openForm()}>
                {#snippet icon()}<Plus size="1em" />{/snippet}
                新建学期
            </Button>
        {/if}
    {/snippet}
    {#if !isAdmin}
        <StateBlock kind="forbidden" description="需要管理员身份才能设置学期。" />
    {:else}
        <ManageNav />
        {#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
        <ResourceState status={terms.status} error={terms.error} refreshing={terms.refreshing} reload={terms.reload}>
            {#if items}
                <Card padding="lg">
                    <div class="current-term">
                        <div class="current-copy">
                            <h2>当前学期</h2>
                            <p>{current ? `${current.name} · ${current.id}` : "尚未设置当前学期"}</p>
                            <p class="muted">切换当前学期后，教师的内容管理和教学班权限随之切换，历史资料与积分保留。</p>
                        </div>
                        {#if current}<Button disabled={busy} onclick={() => setCurrent(null)}>清除当前学期</Button>{/if}
                    </div>
                </Card>
                {#if items.length}
                    <div class="table-scroll">
                        <table aria-label="学期列表">
                            <thead><tr><th>学期编号</th><th>学期名称</th><th>状态</th><th>操作</th></tr></thead>
                            <tbody>
                                {#each items as term (term.id)}
                                    <tr>
                                        <td>{term.id}</td><td>{term.name}</td>
                                        <td>{#if term.current}<Badge tone="accent">当前学期</Badge>{:else}<span class="muted">—</span>{/if}</td>
                                        <td><div class="row-actions">
                                            <Button size="sm" disabled={busy} onclick={() => openForm(term)}>重命名</Button>
                                            <Button size="sm" disabled={busy || term.current} onclick={() => setCurrent(term.id)}>设为当前</Button>
                                        </div></td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {:else}
                    <StateBlock kind="empty" title="还没有学期" description="新建学期后，可以设置当前学期并安排课程开设。" />
                {/if}
            {/if}
        </ResourceState>
    {/if}
</PageLayout>

{#if isAdmin}
    <Dialog bind:open={formOpen} title={selected ? "重命名学期" : "新建学期"} dismissible={!pending}>
        <form class="form" onsubmit={save} aria-busy={pending || undefined} novalidate>
            <Field label="学期编号" required error={idError} help={selected ? "学期编号创建后不可修改。" : "如 2026-fall，使用字母、数字、下划线或短横线。"}>
                {#snippet children({ id, invalid, describedBy })}
                    <TextInput {id} {invalid} aria-describedby={describedBy} bind:value={termId} maxlength={100} disabled={pending || selected !== null} />
                {/snippet}
            </Field>
            <Field label="学期名称" required error={nameError}>
                {#snippet children({ id, invalid, describedBy })}
                    <TextInput {id} {invalid} aria-describedby={describedBy} bind:value={name} maxlength={120} disabled={pending} />
                {/snippet}
            </Field>
            {#if formError}<p class="error" role="alert">{formError}</p>{/if}
            <div class="form-actions">
                <Button disabled={pending} onclick={() => { formOpen = false; }}>取消</Button>
                <Button type="submit" variant="primary" loading={pending} disabled={busy || !changed || !String(termId).trim() || !String(name).trim()}>{selected ? "保存" : "创建学期"}</Button>
            </div>
        </form>
    </Dialog>
{/if}

<style>
    .current-term { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); }
    .current-copy { min-width: 0; display: grid; gap: var(--space-2); }
    h2 { font-size: var(--font-size-lg); }
    .muted { color: var(--color-text-secondary); }
    .table-scroll { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    table { width: 100%; border-collapse: collapse; text-align: left; background: var(--color-surface); }
    th, td { padding: var(--space-4); border-bottom: 1px solid var(--color-border); white-space: nowrap; }
    th { color: var(--color-text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
    tr:last-child td { border-bottom: 0; }
    .row-actions { display: flex; gap: var(--space-2); }
    .form { display: grid; gap: var(--space-4); }
    .form-actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>