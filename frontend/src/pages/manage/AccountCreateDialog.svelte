<script lang="ts">
    import { onDestroy } from "svelte";
    import { api, toApiError } from "$lib/api/client";
    import { userMessage } from "$lib/api/errors";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";
    import Button from "$lib/components/ui/Button.svelte";
    import Checkbox from "$lib/components/ui/Checkbox.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import SegmentedControl from "$lib/components/ui/SegmentedControl.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import { accountColumns, accountErrors, normalizeAccount, type AccountInput } from "../../../../shared/accounts/import";
    import { temporaryPassword } from "./account-import";

    let { open = $bindable(false), onsaved }: { open?: boolean; onsaved: () => void } = $props();
    const profileFields = accountColumns.filter(({ key }) => key !== "role" && key !== "password");
    const roles = [{ value: "student", label: "学生" }, { value: "teacher", label: "教师" }];
    const initial: AccountInput = { role: "student", schoolNumber: "", name: "", department: "", major: "", grade: "", nickname: "", password: "" };
    let form = $state({ ...initial });
    let mustChangePassword = $state(true);
    let pending = $state(false);
    let error = $state("");
    let numberError = $state("");
    let generatedPassword = $state("");
    let attempt: { draft: string; key: string; password: string } | undefined;
    const controller = new AbortController();
    onDestroy(() => controller.abort());
    onBeforeLeave(() => !open || (!pending && mustChangePassword && accountColumns.every(({ key }) => form[key] === initial[key])));

    async function create(event: SubmitEvent) {
        event.preventDefault();
        if (pending) return;
        const values = normalizeAccount(form);
        numberError = values.schoolNumber ? "" : "请填写学工号。";
        error = numberError ? "" : accountErrors(values)[0] ?? "";
        if (numberError || error) return;

        pending = true;
        try {
            const draft = JSON.stringify({ ...values, mustChangePassword });
            if (attempt?.draft !== draft) {
                attempt = { draft, key: crypto.randomUUID(), password: values.password || temporaryPassword() };
            }
            await api.post("/api/admin/accounts", { ...values, password: attempt.password, mustChangePassword }, {
                headers: { "Idempotency-Key": attempt.key }, signal: controller.signal
            });
            if (controller.signal.aborted) return;
            onsaved();
            if (values.password) {
                toast.success(`已新增账号 ${values.schoolNumber}`);
                open = false;
            } else {
                generatedPassword = attempt.password;
            }
            attempt = undefined;
        } catch (cause) {
            if (controller.signal.aborted) return;
            if (toApiError(cause).code === "SCHOOL_NUMBER_EXISTS") numberError = "该学工号已被使用。";
            else error = userMessage(cause, {
                NETWORK_ERROR: "未能确认创建结果，请保留当前填写内容并重试。",
                CREATED_ACCOUNT_CHANGED: "该账号已创建，身份或凭据已变化，请在账号列表中核对。"
            });
        } finally {
            if (!controller.signal.aborted) pending = false;
        }
    }

    async function copyPassword() {
        try { await navigator.clipboard.writeText(generatedPassword); toast.success("密码已复制"); }
        catch { error = "复制失败，请选中上方密码手动复制。"; }
    }
</script>

<Dialog bind:open title={generatedPassword ? "账号已创建" : "新增账号"} dismissible={!pending}>
    {#if generatedPassword}
        <p>学工号 {form.schoolNumber.trim()}</p>
        <Field label="生成的初始密码" help="请复制后交给用户，关闭后无法再次查看。">
            {#snippet children({ id, describedBy })}
                <TextInput {id} aria-describedby={describedBy} value={generatedPassword} readonly autocomplete="off" />
            {/snippet}
        </Field>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="actions">
            <Button onclick={copyPassword}>复制密码</Button>
            <Button variant="primary" onclick={() => { open = false; }}>完成</Button>
        </div>
    {:else}
        <form onsubmit={create} aria-busy={pending || undefined} novalidate>
            <Field label="身份">
                {#snippet children({ id, labelId })}
                    <div><SegmentedControl {id} aria-labelledby={labelId} options={roles} bind:value={form.role} disabled={pending} /></div>
                {/snippet}
            </Field>
            <div class="grid">
                {#each profileFields as { key, label, max } (key)}
                    <Field {label} required={key === "schoolNumber"} error={key === "schoolNumber" ? numberError : undefined}>
                        {#snippet children({ id, describedBy, invalid, required })}
                            <TextInput {id} {invalid} {required} aria-describedby={describedBy} name={key} maxlength={max}
                                autocomplete="off" bind:value={form[key]} disabled={pending} />
                        {/snippet}
                    </Field>
                {/each}
            </div>
            <Field label="初始密码" help="留空自动生成随机密码，手动填写最多 64 个字符。">
                {#snippet children({ id, describedBy })}
                    <TextInput {id} aria-describedby={describedBy} name="password" type="password"
                        autocomplete="new-password" bind:value={form.password} disabled={pending} />
                {/snippet}
            </Field>
            <Checkbox label="要求首次登录修改密码" bind:checked={mustChangePassword} disabled={pending} />
            {#if error}<p class="error" role="alert">{error}</p>{/if}
            <div class="actions">
                <Button disabled={pending} onclick={() => { open = false; }}>取消</Button>
                <Button type="submit" variant="primary" loading={pending}>创建账号</Button>
            </div>
        </form>
    {/if}
</Dialog>

<style>
    form, .grid { display: grid; gap: var(--space-4); }
    .grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-3); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>