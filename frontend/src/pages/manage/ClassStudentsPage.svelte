<script lang="ts">
    import { onDestroy } from "svelte";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { userMessage } from "$lib/api/errors";
    import { router, setTitle, updateQuery } from "$lib/router/router.svelte.js";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";
    import type { PageProps } from "$lib/router/types";
    import { session } from "$lib/session.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import Tabs from "$lib/components/ui/Tabs.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import ManageNav from "./ManageNav.svelte";
    import BonusPolicyDialog from "./BonusPolicyDialog.svelte";
    import StudentEnrollmentDialog from "./StudentEnrollmentDialog.svelte";
    import { classUrl, courseClassesHref, pageCount, pageNumber, teacherLabel, type Page, type TeachingClass } from "./course";

    type Student = { studentId: string; nickname: string | null; schoolNumber: string | null; name: string | null;
        department: string | null; major: string | null; grade: string | null; status: string; totalPoints: number };
    type Ledger = { id: number; studentId: string; studentNickname: string | null; deltaPoints: number; sourceKind: string; reason: string | null; createdAt: number };
    type ImportResult = { addedCount: number; existingCount: number; failedCount: number; duplicateCount: number;
        items: { schoolNumber: string; status: "added" | "existing" | "failed"; code?: string; message?: string }[] };
    let { params }: PageProps = $props();
    const canManage = $derived(session.hasRole("admin") || session.hasRole("teacher"));
    const key = $derived({ courseId: params.courseCode, termId: params.termId, teacherId: params.teacherId });
    const listHref = $derived(courseClassesHref(params.courseCode));
    const page = $derived(pageNumber(router.query.get("page")));
    const ledgerPage = $derived(pageNumber(router.query.get("ledgerPage")));
    const tab = $derived(router.query.get("tab") === "ledger" ? "ledger" : "students");
    const details = resource(async signal => {
        const viewer = session.user?.id, url = classUrl(key);
        if (!canManage) return null;
        return { value: await api.get<TeachingClass>(url, { signal }), viewer };
    });
    const current = $derived(details.data?.viewer === session.user?.id ? details.data?.value : undefined);
    const classLabel = $derived(current ? `${current.term.name} · ${teacherLabel(current.teacher)}` : undefined);
    const students = resource(async signal => {
        const viewer = session.user?.id, currentPage = page;
        if (!current) return null;
        const data = await api.get<Page<Student>>(`${classUrl(current)}/students?page=${currentPage}&pageSize=20`, { signal });
        return { ...data, viewer };
    });
    const ledger = resource(async signal => {
        const viewer = session.user?.id, currentPage = ledgerPage;
        if (!current) return null;
        const data = await api.get<Page<Ledger>>(`${classUrl(current)}/bonus-ledger?page=${currentPage}&pageSize=20`, { signal });
        return { ...data, viewer };
    });
    const tabs = $derived([
        { value: "students", label: "学生名单", count: current?.studentCount },
        { value: "ledger", label: "积分流水", count: ledger.data?.viewer === session.user?.id ? ledger.data?.total : undefined }
    ]);

    $effect(() => { if (current) setTitle(`${current.course.name} · 学生名单`); });
    $effect(() => {
        const changes: { page?: number | null; ledgerPage?: number | null } = {};
        const roster = students.data, records = ledger.data;
        if (roster?.viewer === session.user?.id && roster && !students.refreshing && roster.page === page && page > pageCount(roster)) {
            changes.page = pageCount(roster) === 1 ? null : pageCount(roster);
        }
        if (records?.viewer === session.user?.id && records && !ledger.refreshing && records.page === ledgerPage && ledgerPage > pageCount(records)) {
            changes.ledgerPage = pageCount(records) === 1 ? null : pageCount(records);
        }
        if (Object.keys(changes).length) void updateQuery(changes, { replace: true });
    });

    let pending = $state(false);
    let addOpen = $state(false), adjustOpen = $state(false), policyOpen = $state(false);
    let enrollment = $state.raw<{ student: Student; action: "remove" | "transfer" } | null>(null);
    let enrollmentOpen = $state(false);
    let schoolNumbers = $state("");
    let importResult = $state.raw<ImportResult | null>(null);
    const inputNumbers = $derived(schoolNumbers.split(/\r\n?|\n/).map(number => number.trim()).filter(Boolean));
    const duplicateCount = $derived(inputNumbers.length - new Set(inputNumbers).size);
    const inputError = $derived(inputNumbers.length > 500 ? "每次最多导入500个学号，请分批提交。" : undefined);
    const failedNumbers = $derived(importResult?.items.filter(item => item.status === "failed") ?? []);
    let copyError = $state("");
    let addError = $state(""), adjustError = $state("");
    let target = $state.raw<Student | null>(null);
    let delta = $state<string | number>(""), reason = $state("");
    let attempt: { body: string; key: string } | null = null;
    let alive = true;
    onDestroy(() => { alive = false; });
    onBeforeLeave(() => !pending && !(addOpen && schoolNumbers.trim()) && !(adjustOpen && (String(delta).trim() || reason.trim())));

    function openImport(numbers = "") {
        schoolNumbers = numbers; importResult = null; addError = ""; copyError = ""; addOpen = true;
    }

    async function copyFailures() {
        const viewer = session.user?.id;
        copyError = "";
        try {
            await navigator.clipboard.writeText(failedNumbers.map(item => item.schoolNumber).join("\n"));
            if (alive && viewer === session.user?.id) toast.success("已复制失败学号");
        } catch {
            if (alive && viewer === session.user?.id) copyError = "未能复制，可以点击“修改失败项”后手动复制。";
        }
    }

    async function add(event: SubmitEvent) {
        event.preventDefault();
        const viewer = session.user?.id;
        if (pending || !current?.term.current || !inputNumbers.length || inputError) return;
        pending = true; addError = "";
        try {
            const result = await api.post<ImportResult>(`${classUrl(current)}/students/import`, { schoolNumbers: inputNumbers });
            if (!alive || viewer !== session.user?.id) return;
            importResult = result; schoolNumbers = "";
            details.reload();
            students.reload();
        } catch (cause) {
            if (!alive || viewer !== session.user?.id) return;
            addError = userMessage(cause, { CLASS_IMPORT_UNAVAILABLE: "当前学期、教学班或操作权限已变化，请刷新后重试。",
                default: "未能确认导入结果，可以重试；重复导入不会重复添加。" });
            details.reload();
            students.reload();
        } finally { if (alive && viewer === session.user?.id) pending = false; }
    }

    function openEnrollment(student: Student, action: "remove" | "transfer") {
        enrollment = { student, action }; enrollmentOpen = true;
    }

    function refreshRoster() {
        details.reload(); students.reload(); ledger.reload();
    }

    function openAdjustment(student: Student) {
        target = student; delta = ""; reason = ""; attempt = null; adjustError = ""; adjustOpen = true;
    }

    async function adjust(event: SubmitEvent) {
        event.preventDefault();
        const viewer = session.user?.id;
        if (pending || !current || !target) return;
        const points = Number(delta);
        if (!Number.isSafeInteger(points) || points === 0) { adjustError = "调整分值必须是非零整数，可用负数扣分。"; return; }
        const body = { studentId: target.studentId, deltaPoints: points, reason: reason.trim() || null };
        const json = JSON.stringify(body);
        if (attempt?.body !== json) attempt = { body: json, key: crypto.randomUUID() };
        pending = true; adjustError = "";
        try {
            await api.post(`${classUrl(current)}/bonus-adjustments`, body, { headers: { "Idempotency-Key": attempt.key } });
            if (!alive || viewer !== session.user?.id) return;
            adjustOpen = false; target = null; attempt = null;
            toast.success("已调整积分");
            if (ledgerPage !== 1) void updateQuery({ ledgerPage: null });
            students.reload();
            ledger.reload();
        } catch (cause) {
            if (!alive || viewer !== session.user?.id) return;
            adjustError = userMessage(cause, { default: "未能确认调整结果，先核对积分流水；重试不会重复计分。" });
            students.reload();
            ledger.reload();
        } finally { if (alive && viewer === session.user?.id) pending = false; }
    }

    const sourceLabel: Record<string, string> = { question: "提问", answer: "回答", acceptance: "回答被采纳", comment: "评论", material: "资料版本", manual: "手动调整" };
</script>

<PageLayout title={classLabel ?? "学生名单"} loading={canManage && details.status === "loading"}
    breadcrumbs={[{ label: "课程管理", href: "/manage/courses" }, { label: current?.course.name ?? params.courseCode, href: listHref }, { label: classLabel ?? "学生名单" }]}>
    {#snippet actions()}
        {#if current}
            <Button disabled={pending || details.refreshing} onclick={() => { policyOpen = true; }}>加分规则</Button>
            {#if current.term.current}
                <Button variant="primary" disabled={pending || details.refreshing} onclick={() => openImport()}>添加学生</Button>
            {/if}
        {/if}
    {/snippet}
    {#if !canManage}
        <StateBlock kind="forbidden" description="需要教师或管理员身份才能管理教学班。" />
    {:else}
        <ManageNav />
        <ResourceState status={details.status} error={details.error} refreshing={details.refreshing} reload={details.reload}>
            {#if current}
                <Tabs items={tabs} value={tab} label="教学班名单与积分" onchange={next => { void updateQuery({ tab: next === "ledger" ? next : null }); }}>
                    {#snippet children(active)}
                        {#if active === "students"}
                            <div class="section">
                                <ResourceState status={students.status} error={students.error} refreshing={students.refreshing} reload={students.reload}>
                                    {#if students.data?.viewer === session.user?.id && students.data}
                                        {#if students.data.items.length}
                                            <div class="table-scroll">
                                                <table aria-label="教学班学生名单">
                                                    <thead><tr><th scope="col">学号</th><th scope="col">姓名</th><th scope="col">昵称</th><th scope="col">院系</th><th scope="col">专业</th><th scope="col">年级</th><th scope="col" class="points">积分</th><th scope="col">操作</th></tr></thead>
                                                    <tbody>
                                                        {#each students.data.items as student (student.studentId)}
                                                            <tr>
                                                                <td>{student.schoolNumber ?? "—"}</td><td>{student.status === "deleted" ? "已删除" : student.name ?? "—"}</td>
                                                                <td>{student.nickname ?? "未设置昵称"}</td><td>{student.department ?? "—"}</td><td>{student.major ?? "—"}</td><td>{student.grade ?? "—"}</td>
                                                                <td class="points">{student.totalPoints}</td>
                                                                <td><div class="row-actions">
                                                                    <Button size="sm" disabled={pending || students.refreshing || student.status === "deleted"} onclick={() => openAdjustment(student)}>调整积分</Button>
                                                                    {#if session.hasRole("admin")}<Button size="sm" disabled={pending || students.refreshing} onclick={() => openEnrollment(student, "transfer")}>转班</Button>{/if}
                                                                    <Button size="sm" disabled={pending || students.refreshing} onclick={() => openEnrollment(student, "remove")}>移除学生</Button>
                                                                </div></td>
                                                            </tr>
                                                        {/each}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <Pagination {page} pageCount={pageCount(students.data)} disabled={pending || students.refreshing} aria-label="学生名单分页"
                                                onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }, { scroll: "top" }); }} />
                                        {:else}<StateBlock kind="empty" title="暂无学生" description={current.term.current ? "按学号添加已有学生账号。" : "这个教学班没有学生记录。"} />{/if}
                                    {/if}
                                </ResourceState>
                            </div>
                        {:else}
                            <div class="section">
                                <ResourceState status={ledger.status} error={ledger.error} refreshing={ledger.refreshing} reload={ledger.reload}>
                                    {#if ledger.data?.viewer === session.user?.id && ledger.data}
                                        {#if ledger.data.items.length}
                                            <div class="table-scroll">
                                                <table aria-label="教学班积分流水">
                                                    <thead><tr><th scope="col">学生昵称</th><th scope="col">积分变动</th><th scope="col">来源</th><th scope="col">说明</th><th scope="col">时间</th></tr></thead>
                                                    <tbody>
                                                        {#each ledger.data.items as record (record.id)}
                                                            <tr>
                                                                <td>{record.studentNickname ?? "未设置昵称"}</td><td>{record.deltaPoints > 0 ? "+" : ""}{record.deltaPoints}</td>
                                                                <td>{sourceLabel[record.sourceKind] ?? record.sourceKind}</td><td class="reason">{record.reason || "—"}</td>
                                                                <td><time datetime={new Date(record.createdAt * 1000).toISOString()}>{new Date(record.createdAt * 1000).toLocaleString()}</time></td>
                                                            </tr>
                                                        {/each}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <Pagination page={ledgerPage} pageCount={pageCount(ledger.data)} disabled={pending || ledger.refreshing} aria-label="积分流水分页"
                                                onchange={(next: number) => { void updateQuery({ ledgerPage: next === 1 ? null : next }); }} />
                                        {:else}<StateBlock kind="empty" title="暂无积分记录" />{/if}
                                    {/if}
                                </ResourceState>
                            </div>
                        {/if}
                    {/snippet}
                </Tabs>
            {/if}
        </ResourceState>
    {/if}
</PageLayout>

{#if current}
    <Dialog bind:open={addOpen} title="添加学生" description={`${current.course.name} · ${current.term.name} · ${teacherLabel(current.teacher)}`} dismissible={!pending}>
        {#if importResult}
            <p role="status">新增{importResult.addedCount}人，已在本班{importResult.existingCount}人，失败{importResult.failedCount}人。</p>
            {#if importResult.duplicateCount}<p class="input-summary">已忽略{importResult.duplicateCount}个重复学号。</p>{/if}
            {#if failedNumbers.length}
                <div class="table-scroll import-failures">
                    <table aria-label="导入失败学号">
                        <thead><tr><th scope="col">学号</th><th scope="col">原因</th></tr></thead>
                        <tbody>{#each failedNumbers as item (item.schoolNumber)}<tr><td>{item.schoolNumber}</td><td>{item.message}</td></tr>{/each}</tbody>
                    </table>
                </div>
                {#if copyError}<p class="error" role="alert">{copyError}</p>{/if}
            {/if}
            <div class="actions">
                {#if failedNumbers.length}<Button onclick={copyFailures}>复制失败学号</Button>{/if}
                <Button disabled={!current.term.current} onclick={() => openImport(failedNumbers.map(item => item.schoolNumber).join("\n"))}>{failedNumbers.length ? "修改失败项" : "继续添加"}</Button>
                <Button variant="primary" onclick={() => { addOpen = false; }}>完成</Button>
            </div>
        {:else}
            <form class="form" onsubmit={add} aria-busy={pending || undefined}>
                <Field label="学号" help="每行一个，可从Excel复制学号列，每次最多500个。仅添加已有学生账号；已在本班的跳过，其他班的保留原归属。" error={inputError}>
                    {#snippet children({ id, describedBy, invalid })}<Textarea {id} {invalid} aria-describedby={describedBy} bind:value={schoolNumbers} rows={8} disabled={pending} spellcheck={false} />{/snippet}
                </Field>
                {#if inputNumbers.length}<p class="input-summary" role="status">共{inputNumbers.length}个学号{#if duplicateCount}，其中{duplicateCount}个重复，去重后{inputNumbers.length - duplicateCount}个{/if}。</p>{/if}
                {#if addError}<p class="error" role="alert">{addError}</p>{/if}
                <div class="actions"><Button disabled={pending} onclick={() => { addOpen = false; }}>取消</Button>
                    <Button type="submit" variant="primary" loading={pending} disabled={!inputNumbers.length || !!inputError || !current.term.current}>导入</Button></div>
            </form>
        {/if}
    </Dialog>
    <Dialog bind:open={adjustOpen} title="调整积分" description={target ? `${target.name ?? target.nickname ?? "未设置姓名"} · ${target.schoolNumber ?? ""}` : undefined} dismissible={!pending}>
        <form class="form" onsubmit={adjust} aria-busy={pending || undefined} novalidate>
            <Field label="分值" help="正数加分，负数扣分。">{#snippet children({ id, describedBy })}<TextInput {id} aria-describedby={describedBy} type="number" step={1} bind:value={delta} disabled={pending} />{/snippet}</Field>
            <Field label="说明（可选）">{#snippet children({ id })}<Textarea {id} maxlength={500} bind:value={reason} disabled={pending} />{/snippet}</Field>
            {#if adjustError}<p class="error" role="alert">{adjustError}</p>{/if}
            <div class="actions"><Button disabled={pending} onclick={() => { adjustOpen = false; }}>取消</Button>
                <Button type="submit" variant="primary" loading={pending}>提交调整</Button></div>
        </form>
    </Dialog>
    {#if enrollment}
        <StudentEnrollmentDialog bind:open={enrollmentOpen} bind:pending course={current} student={enrollment.student} action={enrollment.action}
            onrefresh={refreshRoster} onclose={() => { enrollment = null; }} />
    {/if}
    <BonusPolicyDialog bind:open={policyOpen} course={current} onsaved={details.reload} onfailed={details.reload} />
{/if}

<style>
    .section, .form { display: grid; min-width: 0; gap: var(--space-4); }
    .table-scroll { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    table { width: 100%; border-collapse: collapse; text-align: left; background: var(--color-surface); }
    th, td { padding: var(--space-4); border-bottom: 1px solid var(--color-border); white-space: nowrap; }
    th { color: var(--color-text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
    tr:last-child td { border-bottom: 0; }
    .points { text-align: right; font-variant-numeric: tabular-nums; }
    .row-actions { display: flex; gap: var(--space-2); }
    .reason { min-width: 10rem; max-width: 28rem; white-space: normal; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-3); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
    .input-summary { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .import-failures { max-height: 18rem; overflow-y: auto; }
    .import-failures table { table-layout: fixed; }
    .import-failures th, .import-failures td { white-space: normal; overflow-wrap: anywhere; }
</style>