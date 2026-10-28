<script module lang="ts">
    import type { Role } from "$lib/session.svelte.js";

    export type Account = { id: string; nickname: string | null; schoolNumber: string | null; role: Role;
        status: "active" | "disabled"; mustChangePassword: boolean; name: string | null;
        department: string | null; major: string | null; grade: string | null };
    export type Props = {
        open?: boolean;
        account: Account | null;
        onsaved: (account: Account) => void;
        onfailed?: () => void;
    };
</script>

<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { api, toApiError } from "$lib/api/client";
    import { userMessage } from "$lib/api/errors";
    import Button from "$lib/components/ui/Button.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";

    type TextKey = "schoolNumber" | "nickname" | "name" | "department" | "major" | "grade";
    // Limits match the backend's trimmed length checks; maxlength bounds the untrimmed value.
    const fields: { key: TextKey; label: string; max: number }[] = [
        { key: "schoolNumber", label: "学工号", max: 64 },
        { key: "nickname", label: "昵称", max: 80 },
        { key: "name", label: "姓名", max: 80 },
        { key: "department", label: "院系", max: 120 },
        { key: "major", label: "专业", max: 120 },
        { key: "grade", label: "年级", max: 40 }
    ];
    const statuses = [{ value: "active", label: "正常" }, { value: "disabled", label: "禁用" }];

    let { open = $bindable(false), account, onsaved, onfailed }: Props = $props();
    let form = $state<Record<TextKey, string | number>>({ schoolNumber: "", nickname: "", name: "", department: "", major: "", grade: "" });
    let status = $state<string>("active");
    let errors = $state<Partial<Record<TextKey, string>>>({});
    let formError = $state("");
    let pending = $state(false);
    let alive = true;
    onDestroy(() => { alive = false; });

    $effect(() => {
        if (!open || !account) return;
        const current = account;
        untrack(() => {
            for (const { key } of fields) form[key] = current[key] ?? "";
            status = current.status;
            errors = {};
            formError = "";
        });
    });

    const required = (key: TextKey) => key === "schoolNumber";
    // Only submitted fields change on the server, so concurrent edits to other fields are kept.
    const changes = $derived.by(() => {
        const body: Record<string, string | null> = {};
        if (!account) return body;
        for (const { key } of fields) {
            const value = String(form[key]).trim();
            if (value !== (account[key] ?? "")) body[key] = value || null;
        }
        if (status !== account.status) body.status = status;
        return body;
    });
    const revokesSessions = $derived("schoolNumber" in changes || "status" in changes);

    async function save(event: SubmitEvent) {
        event.preventDefault();
        if (pending || !account) return;
        errors = Object.fromEntries(fields.filter(({ key }) => required(key) && !String(form[key]).trim())
            .map(({ key, label }) => [key, `${label}不能为空。`]));
        if (Object.keys(errors).length) return;
        const body = changes, revoked = revokesSessions;
        if (!Object.keys(body).length) return;
        pending = true;
        formError = "";
        try {
            const saved = await api.patch<Account>(`/api/admin/accounts/${encodeURIComponent(account.id)}`, body);
            if (!alive) return;
            onsaved(saved);
            toast.success(revoked ? "已保存，该用户需要重新登录" : "已保存账号信息");
            open = false;
        } catch (cause) {
            if (!alive) return;
            if (toApiError(cause).code === "SCHOOL_NUMBER_EXISTS") {
                errors = { schoolNumber: "该学工号已被其他账号使用。" };
                return;
            }
            formError = userMessage(cause, {
                ACCOUNT_DELETED: "账号身份已变更，请关闭弹窗并重新选择账号。",
                ACCOUNT_NOT_FOUND: "账号身份已变更，请关闭弹窗并重新选择账号。",
                default: "未能确认保存结果。请先核对列表中的账号信息，再决定是否重新编辑。"
            });
            onfailed?.();
        } finally {
            if (alive) pending = false;
        }
    }
</script>

<Dialog bind:open title="编辑账号" description={account ? `${account.schoolNumber ?? "未设置学工号"} · ${account.nickname ?? "未设置昵称"}` : undefined}
    dismissible={!pending}>
    <form class="edit-form" onsubmit={save} aria-busy={pending || undefined}>
        <div class="grid">
            {#each fields as { key, label, max } (key)}
                <Field {label} required={required(key)} error={errors[key]}>
                    {#snippet children({ id, describedBy, invalid })}
                        <TextInput {id} {invalid} aria-describedby={describedBy} name={key} maxlength={max}
                            autocomplete="off" bind:value={form[key]} disabled={pending} />
                    {/snippet}
                </Field>
            {/each}
        </div>
        <Field label="状态" help="禁用后该用户无法登录。">
            {#snippet children({ id, labelId, describedBy })}
                <div><SegmentedControl {id} aria-labelledby={labelId} aria-describedby={describedBy} label="账号状态"
                    options={statuses} bind:value={status} disabled={pending} /></div>
            {/snippet}
        </Field>
        {#if revokesSessions}<p class="warning" role="status">修改学工号或状态后，该用户的所有登录会话会立即注销，需要重新登录。</p>{/if}
        {#if formError}<p class="error" role="alert">{formError}</p>{/if}
        <div class="actions">
            <Button disabled={pending} onclick={() => { open = false; }}>取消</Button>
            <Button type="submit" variant="primary" loading={pending} disabled={!Object.keys(changes).length}>保存</Button>
        </div>
    </form>
</Dialog>

<style>
    .edit-form { display: grid; gap: var(--space-4); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: var(--space-4); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); justify-content: flex-end; }
    .warning { padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-warning-soft); color: var(--color-warning-soft-text); font-size: var(--font-size-sm); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>