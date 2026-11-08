<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { api, ApiError } from "$lib/api/client";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte";
    import { redirect } from "$lib/router/router.svelte";
    import { onBeforeLeave } from "$lib/router/leave.svelte";
    import { validateTags } from "$lib/content/tag-input";
    import { validateDoc, type RichTextDoc } from "$lib/rich-text/index";
    import RichTextEditor from "$lib/rich-text/RichTextEditor.svelte";
    import { createUploadController } from "$lib/files/upload";
    import { validateFile } from "$lib/files/validation";
    import { type UploadController, type UploadSnapshot } from "$lib/files/types";
    import FileDropzone from "$lib/components/files/FileDropzone.svelte";
    import UploadItem from "$lib/components/files/UploadItem.svelte";
    import FileInfo from "$lib/components/files/FileInfo.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import TagInput from "$lib/components/content/TagInput.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import { courseQuestionsHref, emptyDoc, type Course } from "../questions/data";
    import { materialHref, materialPath, uploadRequest, type Material, type MaterialPolicy, type PublishedMaterial } from "./data";

    let { mode, course, material, policy }: { mode: "create" | "edit" | "version"; course: Course; material?: Material; policy?: MaterialPolicy } = $props();
    let title = $state<string | number>(untrack(() => material?.title ?? ""));
    let body = $state<RichTextDoc | null>(untrack(() => structuredClone(material?.body ?? emptyDoc())));
    let tags = $state<string[]>(untrack(() => [...(material?.tags ?? [])]));
    let file = $state<File | null>(null), valid = $state(false), saving = $state(false), saved = $state(false), clearing = $state(false), error = $state("");
    let snapshot = $state<Readonly<UploadSnapshot<PublishedMaterial>>>({ status: "idle", file: null, loaded: 0, total: 0 });
    let upload: UploadController<PublishedMaterial> | undefined;
    let request: ReturnType<typeof uploadRequest> | undefined;
    let unsubscribe: (() => void) | undefined;
    const initial = untrack(() => JSON.stringify([title, body, tags]));
    const invalidInitial = untrack(() => mode === "edit" && material?.body != null && !validateDoc(material.body).ok);
    const busy = $derived(saving || clearing || ["validating", "preparing", "uploading", "confirming"].includes(snapshot.status));
    const locked = $derived(busy || snapshot.status !== "idle");
    const uncertain = $derived(snapshot.status === "confirming" || (snapshot.failure?.stage === "confirming"
        && !["UPLOAD_INCOMPLETE", "UPLOAD_SIZE_MISMATCH", "UPLOAD_TYPE_MISMATCH", "UPLOAD_EXPIRED"].includes(snapshot.failure.code)));
    const titleError = $derived(!String(title).trim() ? "填写文件名" : String(title).trim().length > 200 ? "文件名最多 200 个字符"
        : /[\u0000-\u001f\u007f/\\]/.test(String(title)) || [".", ".."].includes(String(title).trim()) ? "文件名不能包含路径或控制字符" : undefined);
    const tagsError = $derived(validateTags(tags));
    const dirty = $derived(!saved && (Boolean(file) || JSON.stringify([title, body, tags]) !== initial));
    const canSubmit = $derived(mode === "version" ? Boolean(file) : !titleError && !tagsError && valid && Boolean(body) && (mode === "edit" || Boolean(file)));
    const back = $derived(material ? materialHref(material.id) : courseQuestionsHref(course));
    let imageEditor = $state<ReturnType<typeof RichTextEditor>>();
    const controller = new AbortController();
    onBeforeLeave(() => !dirty && !busy);
    onDestroy(() => {
        controller.abort(); unsubscribe?.(); upload?.dispose();
        if (!saved && !uncertain) void request?.cancel().catch(() => {});
    });
    $effect(() => {
        if (snapshot.failure?.stage === "preparing" && snapshot.failure.code === "BODY_IMAGE_UNAVAILABLE") {
            // The server rejected the draft before issuing a file upload ticket.
            resetUpload();
            error = "正文图片已失效。再次发布会重新上传本地图片。";
        } else if (snapshot.status === "done" && snapshot.result && !saved) {
            saved = true;
            toast.success(mode === "version" ? `已发布版本 ${snapshot.result.version}` : "已发布资料");
            redirect(materialHref(snapshot.result.materialId));
        }
    });
    function choose(files: File[]) {
        if (locked || !policy || !files[0]) return;
        const next = files[0], checked = validateFile(next, policy.maxBytes);
        if (!checked.ok) { error = checked.message; return; }
        if (!policy.mimeTypes.includes(checked.mime)) { error = "此文件类型暂不支持上传。"; return; }
        if (mode === "create" && (!String(title).trim() || title === file?.name)) title = next.name;
        file = next; error = "";
    }
    function resetUpload() {
        imageEditor?.resetImageUploads();
        unsubscribe?.(); upload?.dispose();
        upload = undefined; request = undefined;
        snapshot = { status: "idle", file: null, loaded: 0, total: 0 };
    }

    async function clearFile() {
        if (busy || uncertain) return;
        clearing = true; error = "";
        try {
            // Keep the same attempt until the server has acknowledged cancellation.
            await request?.cancel();
            resetUpload();
            file = null;
        } catch (cause) { error = userMessage(cause, { UPLOAD_BUSY: "上传正在确认，稍后重试。", UPLOAD_ALREADY_PUBLISHED: "此文件已发布，重试上传可返回发布结果。" }); }
        finally { clearing = false; }
    }
    async function submit() {
        if (busy || locked || !session.user || !canSubmit || invalidInitial) return;
        if (mode !== "version" && (!imageEditor || !body || !validateDoc(body).ok)) return;
        error = "";
        saving = true;
        try {
            const draft = { title: String(title).trim(), body: mode !== "version" && body && imageEditor ? await imageEditor.prepareImages(body, controller.signal) : null, tags };
            if (mode === "edit" && material) {
                await api.patch(materialPath(material.id), draft, { signal: controller.signal });
                saved = true; saving = false; toast.success("已保存资料"); redirect(back);
                return;
            }
            if (!file || !policy) return;
            request = uploadRequest(mode === "create" ? { mode, courseId: course.id, ...draft } : { mode, materialId: material!.id }, session.user.id);
            upload = createUploadController({ backend: request, maxBytes: policy.maxBytes });
            unsubscribe = upload.subscribe(value => { snapshot = value; });
            saving = false;
            await upload.start(file);
        } catch (cause) {
            if (cause instanceof ApiError && cause.code === "BODY_IMAGE_UNAVAILABLE") imageEditor?.resetImageUploads();
            if (!isAborted(cause)) error = userMessage(cause);
        } finally { saving = false; }
    }
</script>

{#if invalidInitial}<StateBlock kind="error" title="这篇介绍暂时无法编辑" description="原介绍包含当前编辑器不支持的格式。" />
{:else}
    <form class="material-form" onsubmit={event => { event.preventDefault(); void submit(); }} novalidate>
        {#if mode !== "edit"}
            <section class="file-section"><h3>{mode === "version" ? "新版本文件" : "资料文件"}</h3>
                {#if mode === "version"}<p class="hint">公开文件名为“{material?.title}”，所有版本共用此名称。</p>{/if}
                {#if snapshot.status !== "idle"}
                    <UploadItem {snapshot} oncancel={!uncertain ? () => upload?.cancel() : undefined} onretry={() => { void upload?.retry(); }} onremove={!uncertain && !clearing ? () => { void clearFile(); } : undefined} />
                    <p class="hint">重试会沿用这次上传的文件和资料信息。</p>
                {:else if file}
                    <FileInfo name={file.name} size={file.size} mime={file.type} />
                    <div><Button variant="ghost" disabled={busy} onclick={() => { void clearFile(); }}>重新选择文件</Button></div>
                {:else}<FileDropzone maxBytes={policy?.maxBytes} disabled={busy} onfiles={choose} />{/if}
            </section>
        {/if}
        {#if mode !== "version"}
            <Field label="文件名" required help="这是资料的标题，也是所有版本下载时使用的文件名。" error={String(title) ? titleError : undefined}>
                {#snippet children({ id, invalid })}<TextInput {id} {invalid} bind:value={title} disabled={locked} placeholder="例如：微积分讲义.pdf" />{/snippet}
            </Field>
            <Field label="资料介绍" help="介绍内容、适用范围或使用方法。">
                {#snippet children(control)}<RichTextEditor {...control} bind:this={imageEditor} bind:value={body} disabled={locked} onstatechange={state => { valid = state.valid; }} onsubmit={() => { void submit(); }} />{/snippet}
            </Field>
            <Field label="标签" error={tagsError}>{#snippet children(control)}<TagInput {...control} bind:value={tags} disabled={locked} />{/snippet}</Field>
        {/if}
        {#if error}<p class="error">{error}</p>{/if}
        <div class="actions">
            {#if snapshot.status === "idle"}<Button type="submit" variant="primary" loading={saving} disabled={!canSubmit || busy}>{mode === "edit" ? "保存资料" : mode === "version" ? "发布新版本" : "发布资料"}</Button>{/if}
            <Button href={back} disabled={busy}>返回{material ? "资料" : "课程"}</Button>
        </div>
    </form>
{/if}

<style>
    .material-form, .file-section { display: grid; gap: var(--space-5); min-width: 0; }
    .file-section { gap: var(--space-3); }
    h3 { font-size: var(--font-size-lg); }
    .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .error { color: var(--color-danger); }
</style>