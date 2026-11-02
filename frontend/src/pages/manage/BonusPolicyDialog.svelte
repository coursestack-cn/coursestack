<script module lang="ts">
    import type { Course } from "./course";

    export type Props = { open?: boolean; course: Course | null; onsaved: () => void; onfailed?: () => void };
</script>

<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { api } from "$lib/api/client";
    import { userMessage } from "$lib/api/errors";
    import Button from "$lib/components/ui/Button.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import type { BonusPolicy } from "./course";

    type Key = keyof BonusPolicy;
    const fields: { key: Key; label: string }[] = [
        { key: "pointsQuestion", label: "提问" },
        { key: "pointsAnswer", label: "回答" },
        { key: "pointsAcceptance", label: "回答被采纳" },
        { key: "pointsComment", label: "评论" },
        { key: "pointsMaterial", label: "资料首次上传" },
        { key: "pointsMaterialVersion", label: "资料新版本" }
    ];

    let { open = $bindable(false), course, onsaved, onfailed }: Props = $props();
    let values = $state<Record<Key, string | number>>({ pointsQuestion: 0, pointsAnswer: 0, pointsAcceptance: 0,
        pointsComment: 0, pointsMaterial: 0, pointsMaterialVersion: 0 });
    let errors = $state<Partial<Record<Key, string>>>({});
    let formError = $state("");
    let pending = $state(false);
    let alive = true;
    onDestroy(() => { alive = false; });

    $effect(() => {
        if (!open || !course) return;
        const policy = course.bonusPolicy;
        untrack(() => {
            for (const { key } of fields) values[key] = policy[key];
            errors = {};
            formError = "";
        });
    });

    const parse = (value: string | number) => String(value).trim() === "" ? NaN : Number(value);
    const changed = $derived(Boolean(course) && fields.some(({ key }) => parse(values[key]) !== course?.bonusPolicy[key]));

    async function save(event: SubmitEvent) {
        event.preventDefault();
        if (pending || !course) return;
        errors = Object.fromEntries(fields.filter(({ key }) => { const value = parse(values[key]); return !Number.isSafeInteger(value) || value < 0; })
            .map(({ key }) => [key, "请输入不小于 0 的整数。"]));
        if (Object.keys(errors).length || !changed) return;
        const policy = Object.fromEntries(fields.map(({ key }) => [key, parse(values[key])])) as BonusPolicy;
        pending = true;
        formError = "";
        try {
            await api.put(`/api/courses/${encodeURIComponent(course.id)}/bonus-policy`, policy);
            if (!alive) return;
            toast.success("已保存加分规则");
            onsaved();
            open = false;
        } catch (cause) {
            if (!alive) return;
            formError = userMessage(cause, {
                COURSE_NOT_FOUND: "课程不存在或已被删除，请关闭弹窗并刷新列表。",
                400: "提交的分值有误，检查后重试。",
                default: "未能确认保存结果。请先核对课程的加分规则，再决定是否重新保存。"
            });
            onfailed?.();
        } finally {
            if (alive) pending = false;
        }
    }
</script>

<Dialog bind:open title="加分规则" description={course ? `${course.code} · ${course.name}` : undefined} dismissible={!pending}>
    <form class="policy-form" onsubmit={save} aria-busy={pending || undefined} novalidate>
        <p class="hint">每项为本课程学生获得的整数积分，0 表示不计分。修改只影响之后的奖励，已发放的积分不会重算。</p>
        <div class="grid">
            {#each fields as { key, label } (key)}
                <Field {label} error={errors[key]}>
                    {#snippet children({ id, describedBy, invalid })}
                        <TextInput {id} {invalid} aria-describedby={describedBy} name={key} type="number" min={0} step={1}
                            inputmode="numeric" bind:value={values[key]} disabled={pending} />
                    {/snippet}
                </Field>
            {/each}
        </div>
        {#if formError}<p class="error" role="alert">{formError}</p>{/if}
        <div class="actions">
            <Button disabled={pending} onclick={() => { open = false; }}>取消</Button>
            <Button type="submit" variant="primary" loading={pending} disabled={!changed}>保存</Button>
        </div>
    </form>
</Dialog>

<style>
    .policy-form { display: grid; gap: var(--space-4); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr)); gap: var(--space-4); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); justify-content: flex-end; }
    .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>