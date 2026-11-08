<script lang="ts">
    import { api } from "$lib/api/client";
    import { userMessage } from "$lib/api/errors";
    import { resource } from "$lib/api/resource.svelte.js";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import { classUrl, teacherLabel, type Teacher, type TeachingClass } from "./course";

    type Student = { studentId: string; name: string | null; nickname: string | null; schoolNumber: string | null; totalPoints: number };
    let { open = $bindable(false), pending = $bindable(false), course, student, action, onrefresh, onclose }: {
        open?: boolean; pending?: boolean; course: TeachingClass; student: Student; action: "remove" | "transfer";
        onrefresh: () => void; onclose: () => void;
    } = $props();
    const transfer = $derived(action === "transfer");
    const label = $derived([student.name ?? student.nickname, student.schoolNumber ?? student.studentId].filter(Boolean).join(" · "));
    let target = $state(""), error = $state("");
    const teachers = resource(async signal => {
        if (!open || !transfer) return [];
        const { courseId, termId, teacherId } = course;
        const entry = await api.get<{ teachers: Teacher[] }>(`/api/courses/${encodeURIComponent(courseId)}/entry?${new URLSearchParams({ termId })}`, { signal });
        const others = entry.teachers.filter(teacher => teacher.id !== teacherId && !teacher.isDeleted);
        const labels = others.map(teacherLabel);
        return others.map((teacher, index) => ({ value: teacher.id,
            label: labels.indexOf(labels[index]) === labels.lastIndexOf(labels[index]) ? labels[index] : `${labels[index]} · ${teacher.id}` }));
    });
    const validTarget = $derived(teachers.data?.some(option => option.value === target));

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        if (pending || (transfer && (!validTarget || teachers.refreshing))) return;
        pending = true; error = "";
        const url = `${classUrl(course)}/students/${encodeURIComponent(student.studentId)}`;
        try {
            if (transfer) await api.put(`${url}/transfer`, { targetTeacherId: target });
            else await api.delete(url);
            toast.success(transfer ? "学生已转班" : "学生已移除");
            open = false;
        } catch (cause) {
            error = userMessage(cause, { TARGET_CLASS_NOT_FOUND: "目标教学班已删除，请重新选择。",
                ENROLLMENT_NOT_FOUND: "该生已从本课程学期的名单中移除。", STUDENT_ASSIGNMENT_CONFLICT: "该生已转到其他教学班，请核对名单。" });
            if (transfer) teachers.reload();
        } finally {
            pending = false;
            onrefresh();
        }
    }
</script>

<Dialog bind:open title={transfer ? "学生转班" : "移除学生？"} description={`${label} · ${course.course.name} · ${course.term.name} · ${teacherLabel(course.teacher)}`}
    dismissible={!pending} {onclose}>
    <form onsubmit={submit}>
        {#if transfer}
            <ResourceState status={teachers.status} error={teachers.error} refreshing={teachers.refreshing} reload={teachers.reload}>
                {#if teachers.data?.length}
                    <Field label="目标教学班" help={`已有 ${student.totalPoints} 分和积分流水随学生转入新班。`}>
                        {#snippet children({ id, describedBy })}
                            <Select {id} aria-describedby={describedBy} bind:value={target} disabled={pending || teachers.refreshing}
                                options={[{ value: "", label: "选择任课教师", disabled: true }, ...(teachers.data ?? [])]} />
                        {/snippet}
                    </Field>
                {:else}<p>这门课在该学期没有其他教学班。</p>{/if}
            </ResourceState>
        {:else}<p>移除后，该生在本课程本学期的修读记录、现有的 {student.totalPoints} 分和全部积分流水都会删除。</p>{/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="actions">
            <Button disabled={pending} onclick={() => { open = false; }}>取消</Button>
            <Button type="submit" variant={transfer ? "primary" : "danger"} loading={pending} disabled={transfer && (!validTarget || teachers.refreshing)}>
                {transfer ? "确认转班" : "移除学生"}
            </Button>
        </div>
    </form>
</Dialog>

<style>
    form { display: grid; gap: var(--space-4); }
    .actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
    .error { color: var(--color-danger); }
</style>