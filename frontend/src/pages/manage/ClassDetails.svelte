<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte.js";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import BonusPolicyDialog from "./BonusPolicyDialog.svelte";
    import { classUrl, type TeachingClass } from "./course";

    type Student = { studentId: string; nickname: string | null; schoolNumber: string | null; name: string | null;
        department: string | null; major: string | null; grade: string | null; status: string };
    type Page<T> = { items: T[]; page: number; total: number };
    type Ledger = { id: number; studentId: string; studentNickname: string | null; deltaPoints: number; sourceKind: string; reason: string | null; createdAt: number };
    let { value, onback, pending = $bindable(false) }: { value: TeachingClass; onback: () => void; pending?: boolean } = $props();
    let page = $state(1), ledgerPage = $state(1);
    let schoolNumber = $state<string | number>("");
    let policyOpen = $state(false);
    let error = $state("");
    let target = $state.raw<Student | null>(null);
    let delta = $state<string | number>("");
    let reason = $state("");
    let attempt: { body: string; key: string } | null = null;
    const result = resource(async signal => {
        const viewer = session.user?.id, url = classUrl(value), currentPage = page;
        const [teachingClass, students] = await Promise.all([api.get<TeachingClass>(url, { signal }),
            api.get<Page<Student>>(`${url}/students?page=${currentPage}&pageSize=10`, { signal })]);
        return { viewer, teachingClass, students };
    });
    const ledger = resource(async signal => {
        const viewer = session.user?.id;
        const data = await api.get<Page<Ledger>>(`${classUrl(value)}/bonus-ledger?page=${ledgerPage}&pageSize=10`, { signal });
        return { ...data, viewer };
    });
    async function add(event: SubmitEvent) {
        event.preventDefault();
        if (pending || !String(schoolNumber).trim()) return;
        pending = true; error = "";
        try {
            await api.post(`${classUrl(value)}/students`, { schoolNumber: String(schoolNumber).trim() });
            schoolNumber = ""; result.reload();
        } catch (cause) { error = userMessage(cause, { STUDENT_NOT_FOUND: "学生账号不存在，请先由管理员建立账号。",
            STUDENT_ASSIGNMENT_CONFLICT: "该学生已在本课程其他教师班中，或当前学期已变化。" }); }
        finally { pending = false; }
    }
    async function adjust(event: SubmitEvent) {
        event.preventDefault();
        if (pending || !target) return;
        const points = Number(delta);
        if (!Number.isSafeInteger(points) || points === 0) { error = "调整分值必须是非零整数，可用负数扣分。"; return; }
        const body = { studentId: target.studentId, deltaPoints: points, reason: reason.trim() || null };
        const json = JSON.stringify(body);
        if (attempt?.body !== json) attempt = { body: json, key: crypto.randomUUID() };
        pending = true; error = "";
        try {
            await api.post(`${classUrl(value)}/bonus-adjustments`, body, { headers: { "Idempotency-Key": attempt.key } });
            target = null; attempt = null; ledger.reload();
        } catch (cause) { error = userMessage(cause, { default: "未能确认调整结果，请先核对积分流水；重试不会重复计分。" }); ledger.reload(); }
        finally { pending = false; }
    }
    const sourceLabel: Record<string, string> = { question: "提问", answer: "回答", acceptance: "回答被采纳", comment: "评论", material: "资料版本", manual: "手动调整" };
</script>

<div class="stack">
    <div><Button size="sm" disabled={pending} onclick={onback}>返回教学班列表</Button></div>
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if result.data?.viewer === session.user?.id && result.data}
            {@const current = result.data.teachingClass}
            <div class="row"><div><strong>{current.teacher.nickname ?? "未设置昵称"}</strong><p>{current.term.name}，{current.studentCount} 位学生</p></div>
                <Button disabled={pending} onclick={() => { policyOpen = true; }}>加分规则</Button></div>
            <p class="hint">资料与讨论由本课程当期教师共同管理，学生名单和积分规则归属于各教学班。</p>
            {#if current.term.current}
                <form class="row" onsubmit={add}><Field label="按学号添加学生">{#snippet children({ id })}<TextInput {id} bind:value={schoolNumber} maxlength={80} disabled={pending} />{/snippet}</Field>
                    <Button type="submit" disabled={pending || !String(schoolNumber).trim()}>添加学生</Button></form>
            {/if}
            <h3>学生名单</h3>
            {#each result.data.students.items as student (student.studentId)}
                <div class="row"><div><strong>{student.name ?? student.nickname ?? "已删除"}</strong><p>{student.schoolNumber ?? ""}</p>
                    <p class="hint">{[student.department, student.major, student.grade].filter(Boolean).join(" / ")}</p></div>
                    <Button size="sm" disabled={pending || student.status === "deleted"} onclick={() => { target = student; delta = ""; reason = ""; attempt = null; error = ""; }}>调整积分</Button></div>
            {:else}<p>尚无学生。</p>{/each}
            <Pagination page={result.data.students.page} pageCount={Math.ceil(result.data.students.total / 10)} onchange={(next: number) => { page = next; }} />
            {#if target}
                <form class="adjust stack" onsubmit={adjust}>
                    <h3>调整 {target.name ?? target.nickname} 的积分</h3>
                    <Field label="分值" help="正数加分，负数扣分。">{#snippet children({ id })}<TextInput {id} type="number" step={1} bind:value={delta} disabled={pending} />{/snippet}</Field>
                    <Field label="说明（可选）">{#snippet children({ id })}<Textarea {id} maxlength={500} bind:value={reason} disabled={pending} />{/snippet}</Field>
                    <div class="row"><Button disabled={pending} onclick={() => { target = null; }}>取消</Button><Button type="submit" variant="primary" loading={pending}>提交调整</Button></div>
                </form>
            {/if}
            <BonusPolicyDialog bind:open={policyOpen} course={current} onsaved={result.reload} onfailed={result.reload} />
        {/if}
    </ResourceState>
    {#if error}<p class="error">{error}</p>{/if}
    <h3>积分流水</h3>
    <ResourceState status={ledger.status} error={ledger.error} refreshing={ledger.refreshing} reload={ledger.reload}>
        {#if ledger.data?.viewer === session.user?.id && ledger.data}
            {#each ledger.data.items as entry (entry.id)}
                <div class="ledger"><span>{entry.studentNickname ?? "未设置昵称"}</span><strong>{entry.deltaPoints > 0 ? "+" : ""}{entry.deltaPoints}</strong>
                    <span>{sourceLabel[entry.sourceKind] ?? entry.sourceKind}{entry.reason ? `：${entry.reason}` : ""}</span>
                    <small>{new Date(entry.createdAt * 1000).toLocaleString()}</small></div>
            {:else}<p>暂无积分记录。</p>{/each}
            <Pagination page={ledger.data.page} pageCount={Math.ceil(ledger.data.total / 10)} onchange={(next: number) => { ledgerPage = next; }} />
        {/if}
    </ResourceState>
</div>

<style>
    .stack { display: grid; gap: var(--space-4); }
    .row { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); }
    .row :global(.field) { flex: 1; }
    .hint, small { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .adjust { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4); }
    .ledger { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    .error { color: var(--color-danger); }
</style>