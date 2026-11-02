<script module lang="ts">
    import { type Course } from "./course";
    export type Props = { open?: boolean; course: Course | null; onsaved: () => void; onfailed?: () => void; onclose?: () => void };
</script>

<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { api, toApiError } from "$lib/api/client";
    import { userMessage } from "$lib/api/errors";
    import Button from "$lib/components/ui/Button.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";

    let { open = $bindable(false), course, onsaved, onfailed, onclose }: Props = $props();
    const creating = $derived(course === null);
    let name = $state<string | number>("");
    let courseId = $state<string | number>("");
    let introduction = $state("");
    let formError = $state("");
    let pending = $state(false);
    let attempt: { key: string; body: string } | null = null;
    let alive = true;
    onDestroy(() => { alive = false; });
    $effect(() => {
        if (!open) return;
        const current = course;
        untrack(() => {
            name = current?.name ?? ""; courseId = current?.id ?? "";
            introduction = current?.introduction ?? ""; formError = ""; attempt = null;
        });
    });
    const changes = $derived.by(() => {
        const body: Record<string, string> = {};
        if (creating) body.id = String(courseId).trim();
        if (creating || String(name).trim() !== course?.name) body.name = String(name).trim();
        if (creating || introduction.trim() !== course?.introduction) body.introduction = introduction.trim();
        return body;
    });
    async function save(event: SubmitEvent) {
        event.preventDefault();
        if (pending || !Object.keys(changes).length) return;
        if (!String(name).trim() || !String(courseId).trim()) { formError = "请填写课程名称和课程号。"; return; }
        pending = true; formError = "";
        try {
            if (course) await api.patch(`/api/courses/${encodeURIComponent(course.id)}`, changes);
            else {
                const body = JSON.stringify(changes);
                if (attempt?.body !== body) attempt = { key: crypto.randomUUID(), body };
                await api.post("/api/courses", changes, { headers: { "Idempotency-Key": attempt.key } });
            }
            if (!alive) return;
            toast.success(creating ? "已创建课程，可继续安排开设学期" : "已保存课程信息");
            onsaved(); open = false;
        } catch (cause) {
            if (!alive) return;
            if (toApiError(cause).code === "IDEMPOTENCY_CONFLICT") attempt = null;
            formError = userMessage(cause, { COURSE_CONFLICT: "该课程号已存在，或创建权限已变化。",
                ADMIN_REQUIRED: "需要管理员身份才能维护课程信息。", default: "未能确认保存结果，请刷新课程列表核对后重试。" });
            onfailed?.();
        } finally { if (alive) pending = false; }
    }
</script>

<Dialog bind:open title={creating ? "新建课程" : "编辑课程"} description={course ? `${course.id} ${course.name}` : undefined} dismissible={!pending} {onclose}>
    <form class="course-form" onsubmit={save}>
        {#if creating}
            <Field label="课程号" required help="全站唯一，同一课程跨学期沿用，创建后不可修改。">
                {#snippet children({ id, invalid })}<TextInput {id} {invalid} name="courseId" maxlength={40} bind:value={courseId} disabled={pending} />{/snippet}
            </Field>
        {/if}
        <Field label="课程名称" required>
            {#snippet children({ id, invalid })}<TextInput {id} {invalid} name="name" maxlength={120} bind:value={name} disabled={pending} />{/snippet}
        </Field>
        <Field label="课程简介">
            {#snippet children({ id, invalid })}<Textarea {id} {invalid} name="introduction" maxlength={5000} rows={4} bind:value={introduction} disabled={pending} />{/snippet}
        </Field>
        {#if formError}<p class="error">{formError}</p>{/if}
        <div class="actions"><Button disabled={pending} onclick={() => { open = false; }}>取消</Button>
            <Button type="submit" variant="primary" loading={pending} disabled={!Object.keys(changes).length}>{creating ? "创建课程" : "保存"}</Button></div>
    </form>
</Dialog>

<style>
    .course-form { display: grid; gap: var(--space-4); }
    .actions { display: flex; gap: var(--space-3); justify-content: flex-end; }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>