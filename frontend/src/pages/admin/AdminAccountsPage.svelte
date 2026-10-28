<script lang="ts">
    import { onDestroy } from "svelte";
    import type { PageProps } from "$lib/router/types";
    import { api, toApiError, type ApiError } from "$lib/api/client";
    import { userMessage, isAborted } from "$lib/api/errors";
    import { session, type Role } from "$lib/session.svelte.js";
    import { router, updateQuery } from "$lib/router/router.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Checkbox from "$lib/components/ui/Checkbox.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import AccountEditDialog, { type Account } from "./AccountEditDialog.svelte";
    import AdminNav from "./AdminNav.svelte";

    type AccountList = { items: Account[]; page: number; pageSize: number; total: number };
    const roleNames: Record<Role, string> = { admin: "管理员", student: "学生", teacher: "教师" };
    let { params: _params }: PageProps = $props();
    let query = $state<string | number>("");
    const activeQuery = $derived(router.query.get("q") ?? "");
    const page = $derived.by(() => {
        const value = Number(router.query.get("page") ?? 1);
        return Number.isSafeInteger(value) && value > 0 ? value : 1;
    });
    let result = $state.raw<AccountList | null>(null);
    let loading = $state(true);
    let error = $state<ApiError | null>(null);
    let reload = $state(0);
    let open = $state(false);
    let selected = $state.raw<Account | null>(null);
    let password = $state<string | number>("");
    let mustChangePassword = $state(true);
    let pending = $state(false);
    let resetError = $state("");
    let completed = $state(false);
    let generatedPassword = $state("");
    let copied = $state(false);
    let copyError = $state("");
    let editOpen = $state(false);
    let editing = $state.raw<Account | null>(null);
    let alive = true;
    onDestroy(() => { alive = false; });
    $effect(() => { query = activeQuery; });

    $effect(() => {
        if (!session.hasRole("admin")) return;
        const controller = new AbortController();
        const search = new URLSearchParams({ page: String(page), pageSize: "20", q: activeQuery });
        void reload;
        loading = true;
        error = null;
        api.get<AccountList>(`/api/admin/accounts?${search}`, { signal: controller.signal }).then((data) => {
            if (!controller.signal.aborted) result = data;
        }, (cause) => {
            if (!controller.signal.aborted && !isAborted(cause)) error = toApiError(cause);
        }).finally(() => { if (!controller.signal.aborted) loading = false; });
        return () => controller.abort();
    });

    function startEdit(account: Account) {
        editing = account;
        editOpen = true;
    }

    function startReset(account: Account) {
        selected = account;
        password = "";
        mustChangePassword = true;
        resetError = generatedPassword = copyError = "";
        completed = copied = false;
        open = true;
    }

    async function reset(event: SubmitEvent) {
        event.preventDefault();
        if (pending || !selected) return;
        if (new TextEncoder().encode(String(password)).length > 72) {
            resetError = "密码的 UTF-8 编码不能超过 72 字节。";
            return;
        }
        pending = true;
        resetError = "";
        try {
            const account = await api.post<Account & { generatedPassword?: string }>(`/api/admin/accounts/${encodeURIComponent(selected.id)}/password`, {
                newPassword: String(password), mustChangePassword
            });
            if (!alive) return;
            generatedPassword = account.generatedPassword ?? "";
            // Keep the one-time plaintext result only in this dialog, never in list state.
            const { generatedPassword: _generated, ...detail } = account;
            selected = detail;
            if (result) result = { ...result, items: result.items.map((item) => item.id === detail.id ? detail : item) };
            password = "";
            completed = true;
        } catch (cause) {
            if (!alive) return;
            resetError = userMessage(cause, {
                ACCOUNT_DELETED: "账号身份已变更，请关闭弹窗并重新选择账号。",
                INVALID_PASSWORD: "密码的 UTF-8 编码不能超过 72 字节。",
                default: "未能确认重置结果。请先核对账号状态；如需再次重置，请重新打开弹窗。"
            });
            reload++;
        } finally {
            if (alive) pending = false;
        }
    }

    async function copyPassword() {
        copyError = "";
        try { await navigator.clipboard.writeText(generatedPassword); copied = true; }
        catch { copyError = "复制失败，请选中上方密码手动复制。"; }
    }
</script>

<PageLayout title="账号管理" subtitle="编辑学生和教师的账号信息，重置登录密码。">
    {#if !session.hasRole("admin")}
        <p role="alert">需要管理员权限才能查看账号。</p>
    {:else}
        <AdminNav />
        <Card padding="lg">
            <form class="search" onsubmit={(event) => { event.preventDefault(); void updateQuery({ q: String(query).trim() || null, page: null }); reload++; }}>
                <Field label="查找账号" help="支持学工号、昵称、姓名、院系、专业或年级。">
                    {#snippet children({ id, describedBy, invalid })}
                        <TextInput {id} {invalid} aria-describedby={describedBy} type="search" clearable maxlength={100} bind:value={query} />
                    {/snippet}
                </Field>
                <Button type="submit" disabled={loading}>搜索</Button>
            </form>
        </Card>
        {#if loading || error}
            <ResourceState status={error ? "error" : "loading"} {error} reload={() => { reload++; }} />
        {:else if result?.items.length}
            <div class="table-scroll">
                <table>
                    <caption class="sr-only">账号列表</caption>
                    <thead><tr><th>学工号</th><th>昵称</th><th>身份</th><th>状态</th><th>需改密</th><th>操作</th></tr></thead>
                    <tbody>
                        {#each result.items as account (account.id)}
                            <tr>
                                <td>{account.schoolNumber ?? "—"}</td><td>{account.nickname ?? "—"}</td>
                                <td>{roleNames[account.role]}</td>
                                <td>{account.status === "active" ? "正常" : "已禁用"}</td>
                                <td>{account.mustChangePassword ? "需改密" : "—"}</td>
                                <td>{#if account.role !== "admin"}<div class="row-actions">
                                    <Button size="sm" onclick={() => startEdit(account)} aria-label={`编辑 ${account.schoolNumber ?? account.nickname ?? "该账号"}`}>编辑</Button>
                                    {#if account.schoolNumber}
                                        <Button size="sm" onclick={() => startReset(account)} aria-label={`重置 ${account.schoolNumber} 的密码`}>重置密码</Button>
                                    {/if}
                                </div>{:else}—{/if}</td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
            <Pagination {page} pageCount={Math.ceil(result.total / result.pageSize)} onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }); }} />
        {:else}<p>没有找到符合条件的账号。</p>{/if}
    {/if}
</PageLayout>

<Dialog bind:open title={completed ? "密码已重置" : "重置密码"} description={selected ? `${selected.schoolNumber} · ${selected.nickname ?? "未设置昵称"}` : undefined}
    dismissible={!pending} onclose={() => { password = generatedPassword = ""; selected = null; }}>
    {#if completed}
        <p>该账号的所有登录会话已注销。{selected?.mustChangePassword ? "用户下次登录后需要立即修改密码。" : "用户可以使用新密码直接登录。"}</p>
        {#if generatedPassword}
            <Field label="生成的密码" help="密码仅在此次重置结果中显示，请复制后交给用户。">
                {#snippet children({ id, describedBy, invalid })}
                    <TextInput {id} {invalid} aria-describedby={describedBy} value={generatedPassword} readonly autocomplete="off" />
                {/snippet}
            </Field>
            <div><Button onclick={copyPassword}>{copied ? "已复制" : "复制密码"}</Button></div>
            {#if copyError}<p class="error" role="alert">{copyError}</p>{/if}
        {:else}<p>已使用你填写的密码。</p>{/if}
        <div><Button variant="primary" onclick={() => { open = false; }}>完成</Button></div>
    {:else}
        <form class="reset-form" onsubmit={reset} aria-busy={pending || undefined}>
            <Field label="新密码（可选）" help="留空自动生成随机密码；管理员可以设置短密码。">
                {#snippet children({ id, describedBy, invalid })}
                    <TextInput {id} {invalid} aria-describedby={describedBy} name="resetPassword" type="password"
                        autocomplete="new-password" bind:value={password} disabled={pending} />
                {/snippet}
            </Field>
            <Checkbox label="要求用户重置密码" bind:checked={mustChangePassword} disabled={pending} />
            <p class="hint">勾选后，用户下次登录需要先设置至少 8 个字符的新密码。</p>
            {#if resetError}<p class="error" role="alert">{resetError}</p>{/if}
            <div class="actions">
                <Button disabled={pending} onclick={() => { open = false; }}>取消</Button>
                <Button type="submit" variant="primary" loading={pending}>重置密码</Button>
            </div>
        </form>
    {/if}
</Dialog>

<AccountEditDialog bind:open={editOpen} account={editing} onfailed={() => { reload++; }} onsaved={(saved) => {
    if (result) result = { ...result, items: result.items.map((item) => item.id === saved.id ? saved : item) };
}} />

<style>
    .search { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-4); }
    .search :global(.field) { flex: 1; min-width: min(100%, 16rem); }
    .table-scroll { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    table { width: 100%; border-collapse: collapse; text-align: left; background: var(--color-surface); }
    th, td { padding: var(--space-4); border-bottom: 1px solid var(--color-border); white-space: nowrap; }
    th { color: var(--color-text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
    tr:last-child td { border-bottom: 0; }
    .row-actions { display: flex; gap: var(--space-2); }
    .reset-form { display: grid; gap: var(--space-4); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); justify-content: flex-end; }
    .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>