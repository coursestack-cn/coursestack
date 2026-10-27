<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { getThemePreference, setThemePreference, type ThemePreference } from "$lib/theme";
    import Button from "$lib/components/ui/Button.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Checkbox from "$lib/components/ui/Checkbox.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Toaster from "$lib/components/ui/Toaster.svelte";
    import RichText from "$lib/rich-text/RichText.svelte";
    import RichTextEditor, { type EditorState } from "$lib/rich-text/RichTextEditor.svelte";
    import { validateDoc, countChars, type RichTextDoc } from "$lib/rich-text/index";
    import { isEmptyDoc, toPlainText } from "$lib/rich-text/index";
    import { ApiError } from "$lib/api/client";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import AuthorSignature from "$lib/components/content/AuthorSignature.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import VoteControl from "$lib/components/content/VoteControl.svelte";
    import ContentBadge from "$lib/components/content/ContentBadge.svelte";
    import ContentBlock, { type ContentBlockView } from "$lib/components/content/ContentBlock.svelte";
    import QuestionListItem from "$lib/components/content/QuestionListItem.svelte";
    import CommentList from "$lib/components/content/CommentList.svelte";
    import TagInput from "$lib/components/content/TagInput.svelte";
    import type { AuthorView, CommentView, VisibleCommentView, VoteState } from "$lib/content/types";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import FileDropzone from "$lib/components/files/FileDropzone.svelte";
    import UploadItem from "$lib/components/files/UploadItem.svelte";
    import FilePreview from "$lib/components/files/FilePreview.svelte";
    import { createUploadController } from "$lib/files/upload";
    import { createPreviewUrl, revokePreviewUrl } from "$lib/files/urls";
    import type { UploadBackend, UploadSnapshot } from "$lib/files/types";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";

    let theme = $state<string>(getThemePreference());
    let failImage = $state(false);
    let editorDisabled = $state(false);
    let submitMessage = $state("");
    let fullState = $state<EditorState>({ chars: 0, valid: true, reason: null, uploading: 0 });
    const sample: RichTextDoc = {
        type: "doc", content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "从问题到理解" }] },
            { type: "paragraph", content: [
                { type: "text", text: "课栈正文支持", marks: [{ type: "bold" }] },
                { type: "text", text: "斜体", marks: [{ type: "italic" }] },
                { type: "text", text: "、删除线", marks: [{ type: "strike" }] },
                { type: "text", text: " 和 " },
                { type: "text", text: "inline code", marks: [{ type: "code" }] },
                { type: "hardBreak" },
                { type: "text", text: "课程资料", marks: [{ type: "link", attrs: { href: "/courses" } }] },
                { type: "text", text: " · " },
                { type: "text", text: "Tiptap 文档", marks: [{ type: "link", attrs: { href: "https://tiptap.dev" } }] },
                { type: "text", text: "，以及行内公式 " },
                { type: "inlineMath", attrs: { latex: "E = mc^2" } }
            ] },
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "学习清单" }] },
            { type: "bulletList", content: [
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "阅读定义" }] }] },
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "动手验证" }] }] }
            ] },
            { type: "orderedList", attrs: { start: 3 }, content: [
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "分享结论" }] }] }
            ] },
            { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "把思考过程留下，让下一位同学少走弯路。" }] }] },
            { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "示例与公式" }] },
            { type: "codeBlock", attrs: { language: "python" }, content: [{ type: "text", text: "def square(x):\n    return x ** 2\n\nprint(square(5))" }] },
            { type: "blockMath", attrs: { latex: "\\int_0^1 x^2\\,dx = \\frac{1}{3}" } },
            { type: "horizontalRule" },
            { type: "image", attrs: { src: "/favicon.svg", alt: "课栈标志" } }
        ]
    };
    let full = $state<RichTextDoc | null>(structuredClone(sample));
    let compact = $state<RichTextDoc | null>({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "这里可以写一条评论。" }] }] });
    const fixtures = import.meta.glob("../lib/rich-text/fixtures/*.json", { eager: true, import: "default" });
    const invalidFixtures = Object.entries(fixtures).filter(([path]) => path.split("/").at(-1)?.startsWith("invalid-"));

    async function uploadImage(_file: File, signal: AbortSignal) {
        await new Promise<void>((resolve, reject) => {
            if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
            const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1000);
            function abort() { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }
            signal.addEventListener("abort", abort, { once: true });
        });
        if (failImage) throw new Error("Preview upload failure");
        return { src: "/favicon.svg", alt: "模拟上传的课栈标志" };
    }

    const now = Math.floor(Date.now() / 1000);
    const learner: AuthorView = { id: "learner", nickname: "林同学", isDeleted: false, isTeacher: false, isCourseTeacher: false };
    const teacher: AuthorView = { id: "teacher", nickname: "陈老师", isDeleted: false, isTeacher: true, isCourseTeacher: true };
    const unnamed: AuthorView = { id: "unnamed", nickname: null, isDeleted: false, isTeacher: false, isCourseTeacher: false };
    const removed: AuthorView = { id: "removed", nickname: "已删除", isDeleted: true, isTeacher: true, isCourseTeacher: true };
    const paragraph = (text: string): RichTextDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    let identity = $state("member");
    let failVote = $state(false);
    let duplicateReport = $state(false);
    let voteRequests = $state(0);
    let actionMessage = $state("");
    let tags = $state(["线性代数", "解题思路"]);
    let highlighted = $state<string | undefined>("reply-deleted");
    let otherAccepted = $state(false);
    let answerAvailable = $state(true);
    let commentsOpen = $state(true);
    let replyDraft = $state<RichTextDoc | null>(null);
    let replyValid = $state(false);
    let replyPending = $state(false);
    let commentItems = $state<CommentView[]>([
        { kind: "visible", id: "first", author: learner, body: paragraph("这里的秩为什么等于独立列的数量？能举一个具体例子吗？"), createdAt: now - 70, editedAt: now - 20, score: 4, myVote: 0 },
        { kind: "deleted", id: "deleted", createdAt: now - 900 },
        { kind: "visible", id: "reply-deleted", author: teacher, body: paragraph("可以先从一个 2×3 的矩阵看列向量之间的关系。原评论删除后，这条回复仍然保留。"), createdAt: now - 800, score: 6, myVote: 1, replyTo: { id: "deleted", nickname: "旧昵称", authorDeleted: false, contentDeleted: true } },
        { kind: "visible", id: "reply-off-page", author: unnamed, body: paragraph("被回复的评论在另一页，也可以通过摘要正确署名。"), createdAt: now - 3600, score: -1, myVote: 0, replyTo: { id: "off-page", nickname: "陆同学", authorDeleted: false, contentDeleted: false, href: "#comment-first" } },
        { kind: "visible", id: "reply-user-deleted", author: learner, body: paragraph("保留讨论内容，公开署名不再显示已删除账号的信息。"), createdAt: now - 86400, score: 0, myVote: 0, replyTo: { id: "old-author", nickname: "旧昵称", authorDeleted: true, contentDeleted: false } },
        { kind: "visible", id: "reply-unnamed", author: removed, body: paragraph("感谢补充。"), createdAt: now - 172800, score: 2, myVote: 0, replyTo: { id: "unnamed-reply", nickname: null, authorDeleted: false, contentDeleted: false } },
        { kind: "visible", id: "long", author: learner, body: paragraph("讨论应能在窄屏上完整阅读，长文字自然换行。".repeat(18)), createdAt: now - 864000, score: 8, myVote: 0 }
    ]);
    let answer = $state<ContentBlockView>({ id: "demo", kind: "answer", author: learner,
        body: paragraph("矩阵的秩可以看作列向量张成空间的维度。先做消元，再数主元所在的列，就能找到一组基。"),
        createdAt: now - 5400, editedAt: now - 3000, score: 12, myVote: 0, accepted: false });
    const question = $derived<ContentBlockView>({ id: "question-demo", kind: "question", author: unnamed,
        body: paragraph("行秩与列秩为什么相等？"), createdAt: now - 10800, score: 3, myVote: 0, solved: answer.accepted });
    const currentId = $derived(identity === "self" ? learner.id : identity === "teacher" ? teacher.id : "member");

    function voteStateFor(author: AuthorView): VoteState {
        return identity === "anonymous" ? "anonymous" : author.id === currentId ? "self" : "enabled";
    }
    function capabilitiesFor(item: { author: AuthorView }) {
        const loggedIn = identity !== "anonymous";
        const own = loggedIn && item.author.id === currentId;
        return { canEdit: own, canDelete: own || identity === "teacher", canReport: loggedIn,
            canModerate: identity === "teacher", canAccept: identity === "teacher", canReply: loggedIn, voteState: voteStateFor(item.author) };
    }
    const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 1000));
    function requireLogin() { actionMessage = "已触发登录回调；真实页面会保留当前地址后前往登录。"; }
    async function saveVote(id: string, value: -1 | 0 | 1) {
        voteRequests += 1;
        await delay();
        if (failVote) throw new ApiError(503, "PREVIEW_FAILURE", "模拟失败详情不应出现在界面");
        if (id === answer.id) answer = { ...answer, score: answer.score + value - answer.myVote, myVote: value };
        else commentItems = commentItems.map((item) => item.kind === "visible" && item.id === id ? { ...item, score: item.score + value - item.myVote, myVote: value } : item);
    }
    async function report(reason: string) {
        await delay();
        if (duplicateReport) throw new ApiError(409, "DUPLICATE_REPORT", "模拟重复举报");
        actionMessage = `举报回调：${reason}`;
    }
    async function removeComment(id: string) {
        await delay();
        commentItems = commentItems.map((item) => item.id === id ? { kind: "deleted", id: item.id } : item);
        actionMessage = `评论 ${id} 已变为占位，其他回复保留。`;
    }
    async function hideCommentBranch(id: string, reason: string) {
        await delay();
        const hidden = new Set([id]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const item of commentItems) {
                if (item.replyTo && hidden.has(item.replyTo.id) && !hidden.has(item.id)) {
                    hidden.add(item.id);
                    changed = true;
                }
            }
        }
        commentItems = commentItems.filter((item) => !hidden.has(item.id));
        actionMessage = `模拟下架分支：${reason}`;
    }
    async function submitReply(target: VisibleCommentView, close: () => void) {
        if (!replyDraft || !replyValid || isEmptyDoc(replyDraft) || replyPending) return;
        replyPending = true;
        const draft = structuredClone($state.snapshot(replyDraft));
        try {
            await delay();
            commentItems = [...commentItems, { kind: "visible", id: `new-${Date.now()}`, author: identity === "teacher" ? teacher : learner,
                body: draft, createdAt: Math.floor(Date.now() / 1000), score: 0, myVote: 0,
                replyTo: { id: target.id, nickname: target.author.nickname, authorDeleted: target.author.isDeleted, contentDeleted: false, href: `#comment-${target.id}` } }];
            replyDraft = null;
            actionMessage = "回复已模拟提交，已追加到列表末尾。";
            close();
        } finally { replyPending = false; }
    }

    let uploadMode = $state("success");
    let confirmDelay = $state<string | number>(500);
    let prepareCalls = $state(0);
    let confirmCalls = $state(0);
    let uploadEvents = $state<string[]>([]);
    let expiryIssued = false;
    let previews = $state<{ file: File; url: string }[]>([]);
    let previewAlive = true;
    const ownedPreviewUrls = new Set<string>();
    const uploadLimit = 20 * 1024 * 1024;

    function abortableDelay(milliseconds: number, signal: AbortSignal) {
        return new Promise<void>((resolve, reject) => {
            if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
            const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
            function abort() { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); }
            signal.addEventListener("abort", abort, { once: true });
        });
    }
    const uploadBackend: UploadBackend<{ uploadId: string }> = {
        async prepare(request, signal) {
            prepareCalls += 1;
            uploadEvents = [...uploadEvents, `prepare ${request.name}`];
            await abortableDelay(200, signal);
            if (uploadMode === "prepare-failure") throw new ApiError(503, "PREPARE_FAILED", "不直接显示服务端详情");
            const uploadId = crypto.randomUUID();
            const expired = uploadMode === "expired" && !expiryIssued;
            if (expired) expiryIssued = true;
            return {
                uploadId,
                url: `/__dev/upload/${uploadMode === "upload-failure" ? "fail-" : ""}${uploadId}`,
                headers: { "Content-Type": request.type },
                expiresAt: Math.floor(Date.now() / 1000) + (expired ? -10 : 300),
                ...(uploadMode === "duplicate" ? { duplicate: { kind: "same-file" as const, name: request.name } } : {})
            };
        },
        async confirm(uploadId, signal) {
            confirmCalls += 1;
            uploadEvents = [...uploadEvents, `confirm ${uploadId}`];
            await abortableDelay(Math.max(0, Math.min(30000, Number(confirmDelay) || 0)), signal);
            if (uploadMode === "confirm-failure") throw new ApiError(503, "CONFIRM_FAILED", "不直接显示服务端详情");
            return { uploadId };
        }
    };
    const uploader = createUploadController({ backend: uploadBackend, maxBytes: uploadLimit, timeoutMs: 120000 });
    const uploadBusy = $derived.by(() => { $uploader; return uploader.busy; });
    onBeforeLeave(() => !uploader.busy);
    $effect(() => {
        if (!$uploader || !uploader.busy) return;
        const guard = (event: BeforeUnloadEvent) => { if (uploader.busy) { event.preventDefault(); event.returnValue = ""; } };
        window.addEventListener("beforeunload", guard);
        return () => window.removeEventListener("beforeunload", guard);
    });

    function previewFiles(files: File[]) {
        for (const url of ownedPreviewUrls) revokePreviewUrl(url);
        ownedPreviewUrls.clear();
        previews = files.map((file) => {
            const url = createPreviewUrl(file);
            ownedPreviewUrls.add(url);
            return { file, url };
        });
    }

    // Small, valid in-memory examples; no preview asset or real file is sent to a server.
    function samplePdf(): File {
        const stream = "BT /F1 24 Tf 36 170 Td (CourseStack) Tj 0 -40 Td /F1 13 Tf (Local PDF preview) Tj ET";
        const objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
            `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
        ];
        let pdf = "%PDF-1.4\n";
        const offsets = [0];
        objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
        const start = pdf.length;
        pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
        pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
        pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
        return new File([pdf], "课程资料预览.pdf", { type: "application/pdf" });
    }
    onMount(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 240;
        const context = canvas.getContext("2d");
        if (context) {
            const style = getComputedStyle(document.body);
            context.fillStyle = style.backgroundColor;
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = style.color;
            context.font = `${getComputedStyle(document.documentElement).getPropertyValue("--font-size-2xl")} sans-serif`;
            context.fillText("CourseStack", 32, 100);
            context.fillText("Local image preview", 32, 150);
            canvas.toBlob((blob) => {
                if (!previewAlive || !blob || previews.length) return;
                const zip = new Uint8Array(22);
                zip.set([80, 75, 5, 6]);
                previewFiles([new File([blob], "课程示意图.png", { type: "image/png" }), samplePdf(), new File([zip], "课程资料.zip", { type: "application/zip" })]);
            }, "image/png");
        }
    });
    onDestroy(() => {
        previewAlive = false;
        uploader.dispose();
        for (const url of ownedPreviewUrls) revokePreviewUrl(url);
        ownedPreviewUrls.clear();
    });

    const staticUploads: UploadSnapshot<unknown>[] = [
        ["validating", "课程资料.pdf", "application/pdf"],
        ["preparing", "实验记录.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        ["uploading", "一份文件名非常长但仍应保留扩展名的课程汇报与案例分析演示文稿.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
        ["confirming", "成绩样例.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        ["done", "课程示意图.png", "image/png"],
        ["failed", "作业附件.zip", "application/zip"],
        ["cancelled", "旧版资料.doc", "application/msword"],
        ["awaiting-duplicate", "已存在的资料.pdf", "application/pdf"]
    ].map(([status, name, type]) => ({
        status: status as UploadSnapshot<unknown>["status"], file: new File([new Uint8Array(128 * 1024)], name!, { type }),
        loaded: status === "uploading" ? 65536 : ["confirming", "done"].includes(status!) ? 128 * 1024 : 0,
        total: 128 * 1024,
        ...(status === "failed" ? { failure: { stage: "uploading" as const, code: "NETWORK_ERROR", message: "上传失败，检查网络后重试。" } } : {}),
        ...(status === "awaiting-duplicate" ? { duplicate: { kind: "same-file" as const } } : {})
    }));
</script>

<main>
    <header>
        <div><p class="eyebrow">COURSESTACK · 内容组件</p><h1>把课程知识写清楚</h1><p class="intro">正文编辑、阅读与内容交互的独立预览。所有上传和操作均为本地模拟。</p></div>
        <div class="top-actions"><Select aria-label="主题" bind:value={theme} options={[{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }]} onchange={() => setThemePreference(theme as ThemePreference)} /><Link href="/components.html">通用组件预览</Link></div>
    </header>
    <section id="rich-text" aria-labelledby="rich-title">
        <div class="section-heading"><div><p class="eyebrow">01 · 富文本</p><h2 id="rich-title">同一份正文，两种视角</h2></div><Button size="sm" onclick={() => { full = structuredClone(sample); }}>恢复示例</Button></div>
        <div class="options"><Checkbox label="模拟图片上传失败" bind:checked={failImage} /><Checkbox label="禁用编辑器" bind:checked={editorDisabled} /></div>
        <div class="columns">
            <div class="pane">
                <Field label="完整编辑器" help="Ctrl / ⌘ + Enter 触发提交回调；粘贴或拖入图片体验上传。">
                    {#snippet children(control)}<RichTextEditor {...control} bind:value={full} {uploadImage} disabled={editorDisabled} onstatechange={(state) => { fullState = state; }} onsubmit={() => { submitMessage = `提交回调已触发；当前${fullState.valid ? "可" : "不可"}提交。`; }} />{/snippet}
                </Field>
                <p class="status" role="status">{submitMessage || `字数 ${fullState.chars} · ${fullState.valid ? "有效" : fullState.reason ?? "图片上传中"}`}</p>
            </div>
            <div class="pane"><h3>只读效果</h3><RichText doc={full} /></div>
        </div>
        <details><summary>完整编辑器的 JSON 与校验结果</summary><pre data-testid="full-json">{JSON.stringify(full, null, 2)}</pre><pre data-testid="full-validation">{JSON.stringify(full ? { ...validateDoc(full), doc: undefined, chars: countChars(full) } : { ok: false, reason: fullState.reason }, null, 2)}</pre></details>
        <div class="columns compact-demo">
            <div class="pane"><Field label="紧凑评论编辑器" help="示例上限 120 字，80% 起显示计数。">{#snippet children(control)}<RichTextEditor {...control} bind:value={compact} toolbar="compact" maxChars={120} />{/snippet}</Field></div>
            <div class="pane"><h3>评论只读效果</h3><RichText doc={compact} /></div>
        </div>
        <details><summary>紧凑编辑器的 JSON 与校验结果</summary><pre>{JSON.stringify(compact, null, 2)}</pre><pre>{JSON.stringify(compact ? { ...validateDoc(compact), doc: undefined, chars: countChars(compact) } : { ok: false }, null, 2)}</pre></details>
        <h3 class="fixture-heading">非法样例的容错渲染</h3>
        <p class="intro">结构和属性错误局部占位，非法标记忽略。字符或字节超限属于保存限制，渲染另有显示预算。</p>
        <div class="fixtures">{#each invalidFixtures as [path, doc]}<details><summary>{path.split("/").at(-1)}</summary><pre>{JSON.stringify(validateDoc(doc))}</pre><RichText {doc} /></details>{/each}</div>
    </section>
    <section id="content-components" aria-labelledby="content-title">
        <div class="section-heading"><div><p class="eyebrow">02 · 内容交互</p><h2 id="content-title">从一条回复开始</h2></div></div>
        <div class="options">
            <Field label="预览身份">{#snippet children(control)}<Select id={control.id} bind:value={identity} options={[{ value: "anonymous", label: "未登录" }, { value: "self", label: "作者本人" }, { value: "member", label: "普通用户" }, { value: "teacher", label: "有管理权限的教师" }]} />{/snippet}</Field>
            <Checkbox label="投票 1 秒后失败" bind:checked={failVote} />
            <Checkbox label="模拟重复举报（409）" bind:checked={duplicateReport} />
            <Checkbox label="本题已有其他采纳答案" bind:checked={otherAccepted} />
        </div>
        <p class="status" data-testid="vote-requests">投票请求次数：{voteRequests}</p>
        <p class="status" role="status">{actionMessage}</p>
        <div class="signature-samples pane" aria-label="作者与时间示例">
            <AuthorSignature author={learner} createdAt={now - 25} />
            <AuthorSignature author={teacher} createdAt={now - 1200} editedAt={now - 60} />
            <AuthorSignature author={{ ...teacher, isCourseTeacher: false }} size="sm" createdAt={now - 10800} />
            <AuthorSignature author={unnamed} size="sm" />
            <AuthorSignature author={removed} createdAt={now - 180000} />
            <RelativeTime timestamp={new Date(new Date().getFullYear() - 1, 2, 8).getTime() / 1000} />
            <ContentBadge kind="accepted" /><ContentBadge kind="solved" /><ContentBadge kind="unsolved" />
        </div>
        <div class="vote-samples pane" aria-label="投票状态示例">
            {#each ["enabled", "self", "anonymous", "readonly"] as state}
                <div><p>{({ enabled: "可投票", self: "自己的内容", anonymous: "尚未登录", readonly: "只读" })[state]}</p>
                    <VoteControl state={state as VoteState} score={0} myVote={0} onvote={async () => { await delay(); }} onrequirelogin={requireLogin} /></div>
            {/each}
        </div>
        <div class="question-samples pane" aria-label="问题列表示例">
            <QuestionListItem question={{ id: "q1", title: "如何直观理解矩阵的秩？", href: "#answer-demo", excerpt: toPlainText(sample, { maxChars: 120 }), tags, solved: Boolean(answer.accepted), score: 18, answerCount: 4, author: learner, createdAt: now - 5400 }} />
            <QuestionListItem question={{ id: "q2", title: "特征向量与线性变换有什么关系？", href: "#question-question-demo", excerpt: "从几何角度观察变换前后方向保持不变的向量。", tags: [], solved: false, score: 0, author: unnamed, createdAt: now - 90000 }} />
        </div>
        <div class="blocks">
            <ContentBlock content={question} voteState="readonly" onvote={async () => {}} oncomments={() => { actionMessage = "问题评论展开回调已触发。"; }} />
            {#if answerAvailable}
                <ContentBlock content={{ ...answer, commentCount: commentItems.length }} capabilities={capabilitiesFor(answer)} voteState={voteStateFor(answer.author)} {otherAccepted}
                    bind:commentsExpanded={commentsOpen} onvote={(value) => saveVote(answer.id, value)} onrequirelogin={requireLogin}
                    onaccept={async () => { await delay(); answer = { ...answer, accepted: true }; otherAccepted = false; }}
                    onunaccept={async () => { await delay(); answer = { ...answer, accepted: false }; }}
                    onedit={() => { actionMessage = "编辑回调已触发。"; }}
                    ondelete={async () => { await delay(); answerAvailable = false; actionMessage = "回答已删除；它的评论分支不再显示。"; }}
                    onreport={report} onmoderate={async (reason) => { await delay(); answerAvailable = false; actionMessage = `回答已下架：${reason}`; }}>
                    {#snippet comments()}
                        <div class="comment-heading"><h3>评论</h3><Button size="sm" variant="ghost" onclick={() => { highlighted = highlighted ? undefined : "reply-deleted"; }}>切换评论高亮</Button></div>
                        {#if identity === "anonymous"}<Button size="sm" onclick={requireLogin}>登录后回复</Button>{/if}
                        <CommentList items={commentItems} highlightId={highlighted} capabilityFor={capabilitiesFor} onvote={saveVote}
                            onrequirelogin={requireLogin} onedit={(id) => { actionMessage = `编辑评论 ${id}`; }} ondelete={removeComment}
                            onreport={async (_id, reason) => report(reason)}
                            onmoderate={hideCommentBranch}>
                            {#snippet composer(target, close)}
                                <div class="reply-composer">
                                    <Field label="回复正文">{#snippet children(control)}<RichTextEditor {...control} toolbar="compact" bind:value={replyDraft} disabled={replyPending} onstatechange={(state) => { replyValid = state.valid; }} onsubmit={() => { void submitReply(target, close); }} />{/snippet}</Field>
                                    <div class="options"><Button variant="primary" loading={replyPending} disabled={!replyDraft || !replyValid || isEmptyDoc(replyDraft)} onclick={() => submitReply(target, close)}>提交回复</Button><Button disabled={replyPending} onclick={close}>取消回复</Button></div>
                                </div>
                            {/snippet}
                        </CommentList>
                    {/snippet}
                </ContentBlock>
            {:else}
                <StateBlock kind="unavailable"><!-- Intentionally has no nested discussion. --></StateBlock>
                <Button onclick={() => { answerAvailable = true; }}>恢复预览数据</Button>
            {/if}
        </div>
        <div class="pane tag-demo"><Field label="课程标签" help="最多 8 个，每个 30 字；支持粘贴中英文逗号分隔的标签。">{#snippet children(control)}<TagInput {...control} bind:value={tags} />{/snippet}</Field><p class="status">当前标签：{tags.join("、") || "无"}</p></div>
    </section>
    <section id="file-upload" aria-labelledby="files-title">
        <div class="section-heading"><div><p class="eyebrow">03 · 文件与版本</p><h2 id="files-title">上传过程看得见</h2></div></div>
        <p class="intro">示例上限 20 MB，仅用于验证。上传字节由本地开发服务器读完后丢弃；确认由预览回调模拟。</p>
        <div class="upload-settings">
            <Field label="模拟上传场景">{#snippet children(control)}<Select id={control.id} bind:value={uploadMode} onchange={() => { expiryIssued = false; }} options={[
                { value: "success", label: "正常上传" }, { value: "prepare-failure", label: "申请地址失败" }, { value: "upload-failure", label: "上传返回 500" },
                { value: "confirm-failure", label: "确认失败" }, { value: "expired", label: "首次地址已过期" }, { value: "duplicate", label: "提示相同文件已存在" }
            ]} />{/snippet}</Field>
            <Field label="确认延迟（毫秒）">{#snippet children(control)}<TextInput id={control.id} type="number" min={0} max={30000} bind:value={confirmDelay} />{/snippet}</Field>
        </div>
        <FileDropzone disabled={uploadBusy} maxBytes={uploadLimit} onfiles={(files) => { const file = files[0]; if (file) { expiryIssued = false; void uploader.start(file); } }} aria-label="上传资料文件" />
        {#if $uploader.file}<UploadItem snapshot={$uploader} oncancel={() => uploader.cancel()} onretry={() => { void uploader.retry(); }} onremove={() => uploader.reset()} oncontinueDuplicate={() => { void uploader.continueDuplicate(); }} data-testid="active-upload" />{/if}
        <p class="status" data-testid="upload-counters">prepare：{prepareCalls} · confirm：{confirmCalls} · busy：{String(uploadBusy)}</p>
        <p class="intro">切换为正常上传后点击重试，观察失败阶段对应的调用次数。确认失败重试只增加 confirm，上传失败重试会重新 prepare。</p>
        <details><summary>上传状态与调用记录</summary><pre data-testid="upload-state">{JSON.stringify({ ...$uploader, file: $uploader.file ? { name: $uploader.file.name, size: $uploader.file.size, type: $uploader.file.type } : null }, null, 2)}</pre><pre>{uploadEvents.join("\n")}</pre></details>
        <h3 class="fixture-heading">上传项目的各阶段</h3>
        <div class="static-uploads">{#each staticUploads as snapshot}<UploadItem {snapshot} oncancel={() => { actionMessage = "静态示例：取消回调。"; }} onretry={() => { actionMessage = "静态示例：重试回调。"; }} onremove={() => { actionMessage = "静态示例：移除回调。"; }} oncontinueDuplicate={() => { actionMessage = "静态示例：继续上传回调。"; }} />{/each}</div>
        <h3 class="fixture-heading">文件预览</h3>
        <p class="intro">默认提供本页生成的 PNG、PDF 和空 ZIP 样例。也可选择自己的文件，预览留在本页，不发起上传。</p>
        <FileDropzone multiple onfiles={previewFiles} aria-label="选择本地预览文件" />
        <div class="file-previews">{#each previews as preview (preview.url)}<FilePreview src={preview.url} name={preview.file.name} mime={preview.file.type} size={preview.file.size} downloadHref={preview.url} />{/each}</div>
    </section>
</main>
<Toaster />

<style>
    main { max-width: var(--width-page); margin: auto; padding: var(--space-8) var(--space-6); }
    header, .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-6); }
    header { padding-bottom: var(--space-8); border-bottom: 1px solid var(--color-border); }
    h1 { margin-block: var(--space-2); }
    .eyebrow { color: var(--color-accent); font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); letter-spacing: 0.1em; }
    .intro, .status { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .top-actions { display: grid; gap: var(--space-2); flex-shrink: 0; }
    section { padding-block: var(--space-8); }
    .section-heading { margin-bottom: var(--space-5); }
    .options { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-4); }
    .columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-5); }
    .pane { min-width: 0; padding: var(--space-4); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
    .pane h3 { margin-bottom: var(--space-4); }
    .status { margin-top: var(--space-2); }
    .compact-demo, .fixture-heading { margin-top: var(--space-6); }
    details { min-width: 0; border-bottom: 1px solid var(--color-border); padding-block: var(--space-3); }
    summary { cursor: pointer; overflow-wrap: anywhere; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    pre { margin-top: var(--space-3); max-height: calc(var(--space-12) * 8); white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-size-xs); }
    .fixtures { margin-top: var(--space-3); }
    .signature-samples, .vote-samples { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-5); margin-top: var(--space-4); }
    .vote-samples p { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: var(--space-2); }
    .question-samples, .blocks, .tag-demo { margin-top: var(--space-5); }
    .blocks { display: grid; gap: var(--space-4); }
    .comment-heading { display: flex; justify-content: space-between; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .reply-composer { display: grid; gap: var(--space-3); padding-block: var(--space-3); }
    .upload-settings { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-4); margin-block: var(--space-4); }
    .upload-settings > :global(*) { flex: 1 1 calc(var(--space-12) * 5); min-width: 0; }
    .static-uploads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin-block: var(--space-4); }
    .file-previews { display: grid; gap: var(--space-4); margin-top: var(--space-4); }
    @media (max-width: 639px) { .static-uploads { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 639px) { main { padding: var(--space-5) var(--space-3); } header { flex-direction: column; } .top-actions { width: 100%; } .columns { grid-template-columns: minmax(0, 1fr); } .pane { padding: var(--space-3); } }
</style>