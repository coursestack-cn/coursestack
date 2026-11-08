<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { bonusFields, type MyBonusPolicy } from "$lib/bonus";
    import { displayName } from "$lib/content/display-name";
    import { session } from "$lib/session.svelte.js";
    import { router } from "$lib/router/router.svelte.js";
    import { loginHref } from "$lib/router/urls";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";

    let { courseId, manageHref }: { courseId: string; manageHref?: string } = $props();
    const result = resource(async signal => {
        const viewer = session.user?.id, id = courseId;
        if (session.user?.role !== "student") return null;
        const policy = await api.get<MyBonusPolicy>(`/api/me/bonus-policy?${new URLSearchParams({ courseId: id })}`, { signal });
        return { ...policy, viewer };
    });
</script>

{#if session.status === "anonymous"}
    <p class="hint">登录学生账号后，可查看自己本学期教学班的加分规则。</p>
    <Button href={loginHref(router.href)}>登录查看</Button>
{:else if session.user?.role === "teacher" || session.user?.role === "admin"}
    <p class="hint">每个教学班独立设置加分规则，学生按自己本学期所属教学班的规则获得积分。</p>
    {#if manageHref}<Button href={manageHref}>查看教学班</Button>{/if}
{:else}
    <ResourceState status={result.status} error={result.error} reload={result.reload}>
        {#if result.data?.viewer === session.user?.id && result.data}
            {@const policy = result.data}
            {#if policy.membership}
                <p class="hint">{policy.currentTerm?.name} · {displayName(policy.membership.teacher)}的教学班</p>
                <dl class="rules">
                    {#each bonusFields as { key, label } (key)}
                        <div><dt>{label}</dt><dd class:muted={policy.membership.bonusPolicy[key] === 0}>{policy.membership.bonusPolicy[key] === 0 ? "不计分" : `+${policy.membership.bonusPolicy[key]} 分`}</dd></div>
                    {/each}
                </dl>
                <ul class="notes">
                    <li>回答和采纳可以分别加分，赞踩不加分。</li>
                    <li>规则调整只影响之后的奖励，已发放的积分不重算。</li>
                    <li>撤回与补回按原积分记录处理，可在加分历史中查看。</li>
                    <li>积分与课程成绩的折算，以任课教师说明为准。</li>
                </ul>
            {:else if !policy.currentTerm}
                <p class="hint">尚未设置当前学期，暂不产生自动加分。已有积分仍可在加分历史中查看。</p>
            {:else}
                <p class="hint">你尚未加入本课程在{policy.currentTerm.name}的教学班。可以参与资料分享与讨论，但不会获得自动加分；修读关系由任课教师维护。</p>
            {/if}
        {/if}
    </ResourceState>
{/if}

<style>
    .rules { display: grid; gap: var(--space-3); }
    .rules > div { display: flex; justify-content: space-between; gap: var(--space-4); padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border); }
    dd { flex-shrink: 0; color: var(--color-success); font-weight: var(--font-weight-medium); }
    .hint, .notes { color: var(--color-text-secondary); }
    .muted { color: var(--color-text-muted); }
    .notes { display: grid; gap: var(--space-2); padding-left: var(--space-5); font-size: var(--font-size-sm); }
</style>