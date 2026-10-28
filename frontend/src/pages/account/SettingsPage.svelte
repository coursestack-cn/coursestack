<script lang="ts">
    import { onDestroy } from "svelte";
    import type { PageProps } from "$lib/router/types";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { session, type Role } from "$lib/session.svelte.js";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";
    import { formatRelativeTime } from "$lib/content/relative-time";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";

    type Profile = {
        id: string; nickname: string | null; role: Role; schoolNumber: string | null;
        name: string | null; department: string | null; major: string | null;
        grade: string | null; lastLoginAt: number | null;
    };
    const roleNames: Record<Role, string> = { student: "学生", teacher: "教师", admin: "管理员" };
    const academicFields = [
        { key: "schoolNumber", label: "学工号" }, { key: "name", label: "姓名" },
        { key: "department", label: "院系" }, { key: "major", label: "专业" },
        { key: "grade", label: "年级" }
    ] as const;

    let { params: _params }: PageProps = $props();
    const profile = resource<Profile>((signal) => api.get("/api/me/profile", { signal }));
    let nickname = $state<string | number>("");
    let savedNickname = $state("");
    let nicknameError = $state("");
    let saveError = $state("");
    let pending = $state(false);
    let controller: AbortController | undefined;
    const dirty = $derived(profile.status === "ready" && String(nickname).trim() !== savedNickname);
    const lastLogin = $derived(profile.data?.lastLoginAt == null ? null : formatRelativeTime(profile.data.lastLoginAt));

    $effect(() => {
        const value = profile.data?.nickname ?? "";
        nickname = savedNickname = value;
        nicknameError = saveError = "";
    });

    onBeforeLeave(() => !dirty && !pending);
    onDestroy(() => controller?.abort());

    async function saveNickname(event: SubmitEvent) {
        event.preventDefault();
        if (pending || !dirty) return;
        const value = String(nickname).trim();
        nicknameError = saveError = "";
        if (value.length > 80) {
            nicknameError = "昵称最多 80 个字符。";
            return;
        }
        const request = new AbortController();
        controller = request;
        pending = true;
        try {
            const saved = await session.changeNickname(value || null, request.signal);
            if (request.signal.aborted || saved === undefined) return;
            nickname = savedNickname = saved ?? "";
            toast.success("昵称已保存");
        } catch (cause) {
            if (request.signal.aborted || isAborted(cause)) return;
            saveError = userMessage(cause, {
                INVALID_PROFILE_FIELD: "昵称最多 80 个字符。",
                ACCOUNT_DELETED: "账号身份已变更，重新登录后再试。",
                default: "昵称保存失败，请稍后重试。"
            });
        } finally {
            if (!request.signal.aborted) pending = false;
            if (controller === request) controller = undefined;
        }
    }
</script>

<PageLayout title="个人设置" width="prose">
    <ResourceState status={profile.status} error={profile.error} refreshing={profile.refreshing} reload={profile.reload}>
        {#if profile.data}
            <Card padding="lg">
                <form class="section" onsubmit={saveNickname} aria-label="修改昵称" aria-busy={pending || undefined}>
                    <h2>个人资料</h2>
                    <Field label="昵称" help="公开展示的名称，最多 80 个字符；留空可清除昵称。" error={nicknameError}>
                        {#snippet children({ id, describedBy, invalid })}
                            <TextInput {id} {invalid} aria-describedby={describedBy} name="nickname" autocomplete="nickname"
                                maxlength={80} clearable bind:value={nickname} disabled={pending}
                                oninput={() => { nicknameError = saveError = ""; }} />
                        {/snippet}
                    </Field>
                    {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
                    <div class="actions">
                        <Button type="submit" variant="primary" loading={pending} disabled={!dirty}>保存昵称</Button>
                    </div>
                </form>
            </Card>
            <Card padding="lg">
                <section class="section" aria-labelledby="account-info-heading">
                    <div class="section-heading">
                        <h2 id="account-info-heading">账号信息</h2>
                        <p>身份与学籍信息由管理员维护，仅供查看。</p>
                    </div>
                    <dl class="account-details">
                        <div><dt>身份</dt><dd>{roleNames[profile.data.role]}</dd></div>
                        {#each academicFields as field (field.key)}
                            <div><dt>{field.label}</dt><dd>{profile.data[field.key] ?? "未填写"}</dd></div>
                        {/each}
                        <div class="last-login"><dt>最近登录时间</dt><dd>
                            {#if lastLogin}<time datetime={lastLogin.datetime}>{lastLogin.title}</time>
                            {:else}尚无登录记录{/if}
                        </dd></div>
                    </dl>
                </section>
            </Card>
        {/if}
    </ResourceState>
    <Card padding="lg">
        <div class="section">
            <h2>账号安全</h2>
            <p>修改密码后，需要在所有设备上重新登录。</p>
            <div><Button href="/settings/password" disabled={pending}>修改密码</Button></div>
        </div>
    </Card>
</PageLayout>

<style>
    .section { display: grid; gap: var(--space-4); }
    .section-heading { display: grid; gap: var(--space-2); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .account-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: var(--space-5); }
    .account-details > div { display: grid; align-content: start; gap: var(--space-1); min-width: 0; }
    dt { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .last-login { grid-column: 1 / -1; }
    p { color: var(--color-text-secondary); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>