<script module lang="ts">
    export type Props = { admin?: boolean };
</script>

<script lang="ts">
    import { onDestroy } from "svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte.js";
    import { router, navigate } from "$lib/router/router.svelte.js";
    import { loginDestination } from "$lib/router/urls";

    let { admin = false }: Props = $props();
    let schoolNumber = $state<string | number>("");
    let password = $state<string | number>("");
    let pending = $state(false);
    let error = $state("");
    let request: AbortController | undefined;
    const otherLogin = $derived(`${admin ? "/login" : "/admin/login"}?${new URLSearchParams({ next: loginDestination(router.query.get("next")) })}`);

    onDestroy(() => request?.abort());

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        if (pending) return;
        pending = true;
        error = "";
        const destination = loginDestination(router.query.get("next"));
        const controller = new AbortController();
        request = controller;
        try {
            if (admin) await session.adminLogin(String(password), controller.signal);
            else await session.login(String(schoolNumber).trim(), String(password), controller.signal);
            if (!controller.signal.aborted && session.status === "authenticated") await navigate(destination, { replace: true });
        } catch (cause) {
            if (!controller.signal.aborted && !isAborted(cause)) {
                const invalid = admin ? "密码不正确。" : "学工号或密码不正确。";
                error = userMessage(cause, {
                    400: invalid, 401: invalid, 429: "尝试次数过多，稍后再试。", default: "登录失败，稍后重试。"
                });
            }
        } finally {
            pending = false;
        }
    }
</script>

<div class="login-form">
    <Card padding="lg">
        <form onsubmit={submit} aria-busy={pending || undefined}>
            {#if !admin}
                <Field label="学工号" required>
                    {#snippet children({ id, describedBy, invalid, required })}
                        <TextInput {id} {invalid} {required} aria-describedby={describedBy} name="schoolNumber"
                            autocomplete="username" autocapitalize="off" spellcheck={false} bind:value={schoolNumber} disabled={pending} />
                    {/snippet}
                </Field>
            {/if}
            <Field label={admin ? "管理员密码" : "密码"} required>
                {#snippet children({ id, describedBy, invalid, required })}
                    <TextInput {id} {invalid} {required} aria-describedby={describedBy} name="password" type="password"
                        autocomplete="current-password" bind:value={password} disabled={pending} />
                {/snippet}
            </Field>
            {#if error}<p class="error" role="alert">{error}</p>{/if}
            <Button type="submit" variant="primary" loading={pending}>登录</Button>
            <p class="help">忘记密码请联系管理员</p>
        </form>
    </Card>
    <p class="other-login"><Link href={otherLogin}>{admin ? "使用成员账号登录" : "管理员登录"}</Link></p>
</div>

<style>
    .login-form { width: 100%; max-width: calc(var(--space-12) * 9); min-width: 0; display: grid; gap: var(--space-4); }
    form { display: grid; gap: var(--space-5); }
    .error { color: var(--color-danger); font-size: var(--font-size-md); overflow-wrap: anywhere; }
    .help, .other-login { color: var(--color-text-secondary); font-size: var(--font-size-sm); text-align: center; }
</style>