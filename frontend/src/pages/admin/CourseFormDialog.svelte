<script module lang="ts">
    import type { Course } from "./course";

    // A null course opens the dialog in create mode.
    export type Props = { open?: boolean; course: Course | null; onsaved: () => void; onfailed?: () => void };
</script>

<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { api, toApiError } from "$lib/api/client";
    import { isAborted, userMessage } from "$lib/api/errors";
    import Button from "$lib/components/ui/Button.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";

    type Teacher = { id: string; schoolNumber: string | null; nickname: string | null; name: string | null };
    type ErrorKey = "name" | "code" | "teacher";

    let { open = $bindable(false), course, onsaved, onfailed }: Props = $props();
    const creating = $derived(course === null);
    let name = $state<string | number>("");
    let code = $state<string | number>("");
    let introduction = $state("");
    let teacherId = $state("");
    let teacherQuery = $state<string | number>("");
    let teachers = $state.raw<Teacher[]>([]);
    let teacherTotal = $state(0);
    let teachersLoading = $state(false);
    let errors = $state<Partial<Record<ErrorKey, string>>>({});
    let formError = $state("");
    let pending = $state(false);
    // Retries reuse the key only while the request body is unchanged.
    let attempt: { key: string; body: string } | null = null;
    let teacherRequest: AbortController | undefined;
    let alive = true;
    onDestroy(() => { alive = false; teacherRequest?.abort(); });

    $effect(() => {
        if (!open) return;
        const current = course;
        untrack(() => {
            name = current?.name ?? "";
            code = current?.code ?? "";
            introduction = current?.introduction ?? "";
            teacherId = "";
            teacherQuery = "";
            errors = {};
            formError = "";
            attempt = null;
            if (!current) void loadTeachers();
        });
    });

    const teacherOptions = $derived([{ value: "", label: teachers.length ? "请选择任课教师" : "没有可选的教师", disabled: true },
        ...teachers.map((teacher) => ({ value: teacher.id,
            label: `${teacher.schoolNumber ?? "未设置工号"} · ${teacher.name || teacher.nickname || "未设置姓名"}` }))]);
    const teacherHelp = $derived(teacherTotal > teachers.length
        ? `共 ${teacherTotal} 位教师，仅列出前 ${teachers.length} 位，可按工号、姓名或昵称查找。`
        : "只能选择状态正常的教师；课程会在当前学期由该教师任教。");

    async function loadTeachers() {
        teacherRequest?.abort();
        const controller = teacherRequest = new AbortController();
        const search = new URLSearchParams({ role: "teacher", status: "active", pageSize: "20" });
        const q = String(teacherQuery).trim();
        if (q) search.set("q", q);
        teachersLoading = true;
        try {
            const result = await api.get<{ items: Teacher[]; total: number }>(`/api/admin/accounts?${search}`, { signal: controller.signal });
            if (controller.signal.aborted) return;
            teachers = result.items;
            teacherTotal = result.total;
            if (!teachers.some((teacher) => teacher.id === teacherId)) teacherId = "";
        } catch (cause) {
            if (controller.signal.aborted || isAborted(cause)) return;
            errors = { ...errors, teacher: userMessage(cause, { default: "未能加载教师列表，请重新查找。" }) };
        } finally {
            if (!controller.signal.aborted) teachersLoading = false;
        }
    }

    // Edits submit only changed fields, so concurrent edits to other fields are kept.
    const changes = $derived.by(() => {
        const body: Record<string, string> = {};
        const values = { name: String(name).trim(), code: String(code).trim(), introduction: introduction.trim() };
        for (const key of ["name", "code", "introduction"] as const) {
            if (creating || values[key] !== course?.[key]) body[key] = values[key];
        }
        if (creating) body.teacherId = teacherId;
        return body;
    });

    async function save(event: SubmitEvent) {
        event.preventDefault();
        if (pending) return;
        const next: typeof errors = {};
        if (!String(name).trim()) next.name = "课程名称不能为空。";
        if (!String(code).trim()) next.code = "课程编号不能为空。";
        if (creating && !teacherId) next.teacher = "请选择任课教师。";
        errors = next;
        if (Object.keys(next).length) return;
        const body = changes;
        if (!creating && !Object.keys(body).length) return;
        pending = true;
        formError = "";
        try {
            if (course) {
                await api.patch(`/api/courses/${encodeURIComponent(course.id)}`, body);
                if (!alive) return;
                toast.success("已保存课程信息");
            } else {
                const json = JSON.stringify(body);
                if (attempt?.body !== json) attempt = { key: crypto.randomUUID(), body: json };
                await api.post("/api/courses", body, { headers: { "Idempotency-Key": attempt.key } });
                if (!alive) return;
                toast.success("已创建课程");
            }
            onsaved();
            open = false;
        } catch (cause) {
            if (!alive) return;
            const failure = toApiError(cause);
            if (failure.code === "DUPLICATE_RECORD") errors = { code: "该课程编号已存在。" };
            else if (failure.code === "COURSE_CONFLICT") errors = { code: "该课程编号已存在，或当前学期刚刚变化。" };
            else if (failure.code === "TEACHER_REQUIRED") { errors = { teacher: "该教师已不可选，请重新选择。" }; void loadTeachers(); }
            else {
                if (failure.code === "IDEMPOTENCY_CONFLICT") attempt = null;
                formError = userMessage(cause, {
                    NO_CURRENT_TERM: "尚未设置当前学期，暂时不能创建课程。",
                    IDEMPOTENCY_CONFLICT: "提交内容与上次请求不一致，请再次提交。",
                    COURSE_NOT_FOUND: "课程不存在或已被删除，请关闭弹窗并刷新列表。",
                    400: "提交的内容有误，检查后重试。",
                    default: creating ? "未能确认创建结果。请先刷新课程列表核对，避免重复创建。" : "未能确认保存结果。请先核对列表中的课程信息，再决定是否重新编辑。"
                });
                onfailed?.();
            }
        } finally {
            if (alive) pending = false;
        }
    }
</script>

<Dialog bind:open title={creating ? "新建课程" : "编辑课程"} description={course ? `${course.code} · ${course.name}` : undefined} dismissible={!pending}>
    <form class="course-form" onsubmit={save} aria-busy={pending || undefined}>
        <div class="grid">
            <Field label="课程名称" required error={errors.name}>
                {#snippet children({ id, describedBy, invalid })}
                    <TextInput {id} {invalid} aria-describedby={describedBy} name="name" maxlength={120} autocomplete="off" bind:value={name} disabled={pending} />
                {/snippet}
            </Field>
            <Field label="课程编号" required error={errors.code}>
                {#snippet children({ id, describedBy, invalid })}
                    <TextInput {id} {invalid} aria-describedby={describedBy} name="code" maxlength={40} autocomplete="off" bind:value={code} disabled={pending} />
                {/snippet}
            </Field>
        </div>
        <Field label="课程简介">
            {#snippet children({ id, describedBy, invalid })}
                <Textarea {id} {invalid} aria-describedby={describedBy} name="introduction" maxlength={5000} rows={4} bind:value={introduction} disabled={pending} />
            {/snippet}
        </Field>
        {#if creating}
            <Field label="任课教师" required help={teacherHelp} error={errors.teacher}>
                {#snippet children({ id, describedBy, invalid })}
                    <div class="teacher-search">
                        <TextInput type="search" aria-label="查找教师" placeholder="工号、姓名或昵称" maxlength={100} bind:value={teacherQuery}
                            disabled={pending} onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); void loadTeachers(); } }} />
                        <Button disabled={pending} loading={teachersLoading} onclick={() => { void loadTeachers(); }}>查找</Button>
                    </div>
                    <Select {id} {invalid} aria-describedby={describedBy} name="teacherId" options={teacherOptions} bind:value={teacherId} disabled={pending} />
                {/snippet}
            </Field>
        {/if}
        {#if formError}<p class="error" role="alert">{formError}</p>{/if}
        <div class="actions">
            <Button disabled={pending} onclick={() => { open = false; }}>取消</Button>
            <Button type="submit" variant="primary" loading={pending} disabled={!creating && !Object.keys(changes).length}>{creating ? "创建课程" : "保存"}</Button>
        </div>
    </form>
</Dialog>

<style>
    .course-form { display: grid; gap: var(--space-4); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: var(--space-4); }
    .teacher-search { display: flex; gap: var(--space-2); }
    .teacher-search > :global(:first-child) { flex: 1; min-width: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); justify-content: flex-end; }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>