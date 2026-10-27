<script lang="ts">
    import type { PageProps } from "$lib/router/types";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import { userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte.js";
    import { deferAuthRedirects, navigate } from "$lib/router/router.svelte.js";

    let { params: _params }: PageProps = $props();
    let oldPassword = $state<string | number>("");
    let newPassword = $state<string | number>("");
    let confirmation = $state<string | number>("");
    let pending = $state(false);
    let error = $state("");
    const required = $derived(session.user?.mustChangePassword ?? false);

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        if (pending) return;
        error = "";
        const password = String(newPassword);
        if (Array.from(password).length < 8 || new TextEncoder().encode(password).length > 72) {
            error = "新密码至少 8 个字符，UTF-8 编码不超过 72 字节。";
            return;
        }
        if (password !== String(confirmation)) { error = "两次输入的新密码不一致。"; return; }
        if (required && password === String(oldPassword)) { error = "新密码不能与临时密码相同。"; return; }
        const destination = session.hasRole("admin") ? "/admin/login" : "/login";
        const release = deferAuthRedirects();
        pending = true;
        try {
            await session.changePassword(String(oldPassword), password);
            oldPassword = newPassword = confirmation = "";
            toast.success("密码已修改，请使用新密码重新登录");
            await navigate(destination, { replace: true });
        } catch (cause) {
            error = userMessage(cause, {
                INVALID_CURRENT_PASSWORD: "当前密码不正确。",
                INVALID_PASSWORD: "新密码至少 8 个字符，UTF-8 编码不超过 72 字节。",
                PASSWORD_UNCHANGED: "新密码不能与临时密码相同。",
                SESSION_CHANGED: "会话已变化，请重新登录后再试。"
            });
        } finally {
            pending = false;
            release();
        }
    }
</script>

<PageLayout title="修改密码" width="prose"
    subtitle={required ? "管理员要求你修改密码。完成后即可继续使用课栈。" : "修改密码后，需要在所有设备上重新登录。"}>
    <Card padding="lg">
        <form onsubmit={submit} aria-busy={pending || undefined}>
            <Field label={required ? "临时密码" : "当前密码"} required>
                {#snippet children({ id, describedBy, invalid, required })}
                    <TextInput {id} {invalid} {required} aria-describedby={describedBy} name="oldPassword" type="password"
                        autocomplete="current-password" bind:value={oldPassword} disabled={pending} />
                {/snippet}
            </Field>
            <Field label="新密码" required help="至少 8 个字符，UTF-8 编码不超过 72 字节。">
                {#snippet children({ id, describedBy, invalid, required })}
                    <TextInput {id} {invalid} {required} aria-describedby={describedBy} name="newPassword" type="password"
                        autocomplete="new-password" bind:value={newPassword} disabled={pending} />
                {/snippet}
            </Field>
            <Field label="确认新密码" required>
                {#snippet children({ id, describedBy, invalid, required })}
                    <TextInput {id} {invalid} {required} aria-describedby={describedBy} name="confirmation" type="password"
                        autocomplete="new-password" bind:value={confirmation} disabled={pending} />
                {/snippet}
            </Field>
            {#if error}<p class="error" role="alert">{error}</p>{/if}
            <div class="actions">
                <Button type="submit" variant="primary" loading={pending}>保存新密码</Button>
                {#if !required}<Button href="/settings" disabled={pending}>返回设置</Button>{/if}
            </div>
        </form>
    </Card>
</PageLayout>

<style>
    form { display: grid; gap: var(--space-5); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>