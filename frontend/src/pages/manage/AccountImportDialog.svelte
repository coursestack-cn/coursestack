<script lang="ts">
    import { onDestroy } from "svelte";
    import { api, toApiError } from "$lib/api/client";
    import { userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte.js";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Checkbox from "$lib/components/ui/Checkbox.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import { ACCOUNT_IMPORT_BYTES, AccountCsvError, parseAccountCsv, accountCredentialsCsv, failedAccountsCsv, roleLabel,
        type ImportRow, type PreviewItem } from "../../../../shared/accounts/import";
    import { downloadCsv, temporaryPassword } from "./account-import";

    type Status = PreviewItem["status"] | "created" | "creating" | "failed" | "uncertain" | "unprocessed";
    type WorkRow = ImportRow & { status: Status; message: string; requestKey: string; preparedPassword?: string };
    let { open = $bindable(false), onsaved }: { open?: boolean; onsaved: () => void } = $props();
    let rows = $state<WorkRow[]>([]), fileName = $state(""), error = $state("");
    let busy = $state(false), started = $state(false), mustChangePassword = $state(true);
    let downloaded = $state(false), confirmClose = $state(false), issuesOnly = $state(false), page = $state(1);
    let input = $state<HTMLInputElement>();
    let controller = new AbortController(), generation = 0, alive = true;
    const labels: Record<Status, string> = { ready: "可创建", existing: "已存在", invalid: "错误", duplicate: "重复", created: "已创建",
        creating: "创建中", failed: "失败", uncertain: "待确认", unprocessed: "未处理" };
    const issues = new Set<Status>(["invalid", "failed", "uncertain"]);
    const eligible = new Set<Status>(["ready", "unprocessed", "uncertain"]);
    const count = (status: Status) => rows.filter(row => row.status === status).length;
    const createdCount = $derived(count("created"));
    const remainingCount = $derived(rows.filter(row => eligible.has(row.status)).length);
    const problemCount = $derived(rows.filter(row => issues.has(row.status)).length);
    const unsavedCredentials = $derived(createdCount > 0 && !downloaded);
    const unfinished = $derived(started && remainingCount > 0);
    const filtered = $derived(issuesOnly ? rows.filter(row => issues.has(row.status)) : rows);
    const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / 20)));
    const completedCount = $derived(rows.filter(row => !eligible.has(row.status) && row.status !== "creating").length);
    $effect(() => { if (page > pageCount) page = pageCount; });
    onDestroy(() => { alive = false; generation++; controller.abort(); rows = []; });
    onBeforeLeave(() => !open || (!busy && !remainingCount && !unsavedCredentials));

    function clear(resetFile = true) {
        generation++; controller.abort(); controller = new AbortController();
        rows = []; fileName = ""; error = ""; busy = started = downloaded = issuesOnly = false; mustChangePassword = true; page = 1;
        if (resetFile && input) input.value = "";
    }
    function close() { if (unsavedCredentials || unfinished) confirmClose = true; else open = false; }
    const active = (run: number, viewer: string | undefined) => alive && run === generation && viewer === session.user?.id;

    async function selectFile() {
        const file = input?.files?.[0];
        if (!file || busy) return;
        clear(false); fileName = file.name;
        const run = generation, viewer = session.user?.id;
        busy = true;
        try {
            if (!file.name.toLowerCase().endsWith(".csv")) throw new AccountCsvError("请选择CSV文件。Excel文件请另存为CSV UTF-8格式。");
            if (file.size > ACCOUNT_IMPORT_BYTES) throw new AccountCsvError("文件不能超过2MiB，请分批导入。");
            const bytes = await file.arrayBuffer();
            if (!active(run, viewer)) return;
            let text: string;
            try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
            catch { throw new AccountCsvError("文件不是有效的UTF-8编码，请另存为CSV UTF-8格式。"); }
            const parsed = parseAccountCsv(text);
            const preview = await api.post<{ items: PreviewItem[] }>("/api/admin/accounts/import/preview", { rows: parsed }, { signal: controller.signal });
            if (!active(run, viewer)) return;
            const results = new Map(preview.items.map(item => [item.line, item]));
            rows = parsed.map(row => ({ ...row, ...results.get(row.line)!, requestKey: crypto.randomUUID() }));
        } catch (cause) {
            if (active(run, viewer)) error = cause instanceof AccountCsvError ? cause.message : userMessage(cause, { default: "预检未完成，请重新选择文件重试。" });
        } finally { if (active(run, viewer)) busy = false; }
    }

    async function createAccounts() {
        if (busy || !remainingCount) return;
        const run = generation, viewer = session.user?.id, todo = rows.filter(row => eligible.has(row.status));
        started = busy = true; error = "";
        for (const row of todo) {
            row.preparedPassword ??= row.values.password || temporaryPassword();
            row.status = "unprocessed";
        }
        let next = 0, stopped = false;
        async function process() {
            while (!stopped && active(run, viewer) && next < todo.length) {
                const row = todo[next++]!;
                row.status = "creating"; row.message = "";
                try {
                    await api.post("/api/admin/accounts", { ...row.values, password: row.preparedPassword, mustChangePassword }, {
                        headers: { "Idempotency-Key": row.requestKey }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])
                    });
                    if (!active(run, viewer)) return;
                    row.status = "created"; downloaded = false;
                } catch (cause) {
                    if (!active(run, viewer)) return;
                    const failure = toApiError(cause);
                    if (failure.code === "SCHOOL_NUMBER_EXISTS") {
                        try {
                            const preview = await api.post<{ items: PreviewItem[] }>("/api/admin/accounts/import/preview", { rows: [{ line: row.line, values: row.values }] }, { signal: controller.signal });
                            if (!active(run, viewer)) return;
                            row.status = preview.items[0]?.status === "existing" ? "existing" : "failed";
                            row.message = preview.items[0]?.message || "学工号状态已变化，请重新预检。";
                        } catch { if (!active(run, viewer)) return; row.status = "failed"; row.message = "学工号已被使用，请重新预检核对。"; }
                    } else if (failure.status === 0 || failure.status >= 500 || failure.status === 429 || failure.code === "INVALID_RESPONSE") {
                        row.status = "uncertain"; row.message = "结果待确认，可安全重试。"; stopped = true;
                        error = "导入已暂停。已创建的账号保留，重试将继续确认结果并处理剩余行。";
                    } else {
                        row.status = "failed";
                        row.message = userMessage(cause, {
                            IDEMPOTENCY_CONFLICT: "创建请求内容已变化，请重新预检。",
                            CREATED_ACCOUNT_CHANGED: "此前已创建账号，但账号或密码已变化，请在账号管理中核对。",
                            default: "该行创建失败，请核对资料或重新预检。"
                        });
                        if (failure.status === 401 || failure.status === 403 || failure.code === "ACCOUNT_CHANGED" || failure.code === "ACCOUNT_DELETED") {
                            stopped = true; error = "登录账号或权限已变化，导入已暂停。";
                        }
                    }
                }
            }
        }
        await Promise.all([process(), process()]);
        if (!active(run, viewer)) return;
        busy = false; onsaved();
    }

    function credentials() {
        downloadCsv("新建账号凭据.csv", accountCredentialsCsv(rows.filter(row => row.status === "created")
            .map(row => ({ line: row.line, values: { ...row.values, password: row.preparedPassword! } }))));
        downloaded = true;
    }
    function failures() {
        downloadCsv("账号导入失败记录.csv", failedAccountsCsv(rows.filter(row => issues.has(row.status) || row.status === "unprocessed")
            .map(row => ({ ...row, values: { ...row.values, password: row.preparedPassword ?? row.values.password }, message: row.message || "尚未处理" }))));
    }
</script>

<Dialog bind:open title="CSV批量创建账号" description="上传学生或教师账号名单，预检后创建有效账号。" style="width: min(72rem, calc(100% - var(--space-8))); max-width: none;" dismissible={!busy && !unsavedCredentials && !unfinished} onclose={() => clear()}>
    <div class="import-form">
        {#if !started}
            <label class="file-field">CSV文件
                <input bind:this={input} type="file" accept=".csv,text/csv" disabled={busy} onchange={selectFile} />
            </label>
            <p class="hint">每个文件最多500条、2MiB，使用UTF-8编码。身份和学工号必填，其他字段可留空；学工号列请在Excel中设为文本，保留前导零。</p>
            <Checkbox label="要求首次登录修改密码" bind:checked={mustChangePassword} disabled={busy} />
            <p class="hint">初始密码留空时为每个账号生成随机密码。昵称留空时由用户自行设置。</p>
        {/if}
        {#if fileName}<p class="filename">{fileName}</p>{/if}
        {#if busy && !started}<p role="status">正在预检CSV…</p>{/if}
        {#if rows.length}
            <p role="status" class="summary">共{rows.length}条，{started ? "已创建" : "可创建"}{started ? createdCount : count("ready")}条，已存在{count("existing")}条，重复{count("duplicate")}条，{started ? "需处理" : "错误"}{problemCount}条{#if started}，未处理{count("unprocessed")}条{/if}。</p>
            {#if started}<progress value={completedCount} max={rows.length} aria-label="账号创建进度"></progress>{/if}
            <Checkbox label="只看错误和待确认的行" checked={issuesOnly} onchange={(event) => { issuesOnly = event.currentTarget.checked; page = 1; }} />
            <div class="table-scroll">
                <table aria-label="账号导入预检与结果">
                    <thead><tr><th scope="col">行号</th><th scope="col">身份</th><th scope="col">学工号</th><th scope="col">姓名</th><th scope="col">院系 / 专业 / 年级</th><th scope="col">昵称</th><th scope="col">状态</th><th scope="col">说明</th></tr></thead>
                    <tbody>
                        {#each filtered.slice((page - 1) * 20, page * 20) as row (row.line)}
                            <tr><td>{row.line}</td><td>{roleLabel(row.values.role)}</td><td>{row.values.schoolNumber || "—"}</td><td>{row.values.name || "—"}</td>
                                <td>{[row.values.department, row.values.major, row.values.grade].filter(Boolean).join(" / ") || "—"}</td><td>{row.values.nickname || "—"}</td>
                                <td class:error={issues.has(row.status)}>{labels[row.status]}</td><td class="reason">{row.message || "—"}</td></tr>
                        {:else}<tr><td colspan="8">没有需要处理的行。</td></tr>{/each}
                    </tbody>
                </table>
            </div>
            {#if pageCount > 1}<Pagination {page} {pageCount} onchange={(next: number) => { page = next; }} />{/if}
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        {#if createdCount}<p class="hint">新建账号的初始密码仅在当前页面保留，请下载后交给用户。CSV中的文本保护前缀单引号不属于原始学工号或密码。</p>{/if}
        {#if problemCount || count("unprocessed")}<p class="hint">失败记录可修正后重新上传；文件中的文本保护前缀会在重新导入时自动还原。</p>{/if}
        <div class="actions">
            {#if createdCount}<Button disabled={busy} onclick={credentials}>下载新建账号凭据</Button>{/if}
            {#if problemCount || count("unprocessed")}<Button disabled={busy} onclick={failures}>下载失败记录</Button>{/if}
            <Button disabled={busy} onclick={close}>{started ? "完成" : "取消"}</Button>
            {#if remainingCount}<Button variant="primary" loading={busy && started} disabled={busy} onclick={createAccounts}>{started ? "重试并继续" : `创建有效的${remainingCount}个账号`}</Button>{/if}
        </div>
    </div>
</Dialog>
<ConfirmDialog bind:open={confirmClose} title="关闭导入结果？" description={unfinished
    ? "尚有待确认或未处理的账号，请先重试或下载记录。关闭后不能继续确认本次请求，也无法恢复未保存的随机初始密码。"
    : "尚未下载新建账号凭据。关闭后无法恢复随机初始密码，需要通过账号管理重新设置。"} confirmLabel="仍然关闭" onconfirm={() => { open = false; }} />

<style>
    .import-form, .file-field { display: grid; min-width: 0; gap: var(--space-3); }
    input[type="file"] { width: 100%; min-width: 0; }
    .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .filename, .summary { overflow-wrap: anywhere; }
    progress { width: 100%; accent-color: var(--color-accent); }
    .table-scroll { overflow: auto; max-height: 24rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: var(--font-size-sm); }
    th, td { padding: var(--space-3); border-bottom: 1px solid var(--color-border); white-space: nowrap; }
    th { color: var(--color-text-secondary); font-weight: var(--font-weight-medium); }
    .reason { min-width: 12rem; white-space: normal; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-3); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>