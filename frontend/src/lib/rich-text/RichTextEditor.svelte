<script module lang="ts">
    import type { RichTextDoc } from "./index";

    export type EditorState = { chars: number; valid: boolean; reason: string | null; uploading: number };
    export type Props = {
        value?: RichTextDoc | null;
        placeholder?: string;
        toolbar?: "full" | "compact";
        maxChars?: number;
        uploadImage?: (file: File, signal: AbortSignal) => Promise<{ src: string; alt?: string }>;
        disabled?: boolean;
        invalid?: boolean;
        id?: string;
        labelId?: string;
        describedBy?: string;
        onsubmit?: () => void;
        onstatechange?: (state: EditorState) => void;
    };
</script>

<script lang="ts">
    import { tick, untrack } from "svelte";
    import { Editor } from "@tiptap/core";
    import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
    import { NodeSelection, Plugin, PluginKey, TextSelection, type Selection, type SelectionBookmark } from "@tiptap/pm/state";
    import { closeHistory } from "@tiptap/pm/history";
    import { Decoration, DecorationSet } from "@tiptap/pm/view";
    import { Bold, Italic, Strikethrough, Code, Link as LinkIcon, Braces, Sigma, Heading2, Heading3, Heading4, List, ListOrdered, Quote, Minus, ImagePlus, Undo2, Redo2 } from "@lucide/svelte";
    import Button from "../components/ui/Button.svelte";
    import Dialog from "../components/ui/Dialog.svelte";
    import Field from "../components/ui/Field.svelte";
    import TextInput from "../components/ui/TextInput.svelte";
    import Textarea from "../components/ui/Textarea.svelte";
    import Select from "../components/ui/Select.svelte";
    import MathPreview from "./MathPreview.svelte";
    import { BodyImageDrafts, imageFileError } from "./body-images";
    import { createEditorExtensions, cursorAfterImage, sanitizePastedHTML } from "./editor-extensions";
    import { CODE_LANGUAGES, RICH_TEXT_LIMITS, countChars, normalizeHref, validateDoc } from "./index";
    import "./rich-text.css";

    const generatedId = $props.id();
    let { value = $bindable(null), placeholder = "输入正文…", toolbar = "full", maxChars = RICH_TEXT_LIMITS.maxChars,
        uploadImage, disabled = false, invalid = false, id = generatedId, labelId, describedBy, onsubmit, onstatechange }: Props = $props();
    let editor = $state.raw<Editor | null>(null);
    let revision = $state(0);
    let chars = $state(0);
    let contractError = $state<string | null>(null);
    let message = $state("");
    let uploads = $state<{ id: string; name: string }[]>([]);
    let activeButton = $state(0);
    let imageInput: HTMLInputElement;
    let imageOpen = $state(false), imageError = $state("");
    let imageUrl = $state<string | number>(""), imageAlt = $state<string | number>("");
    const imageDrafts = new BodyImageDrafts();

    export function prepareImages(body: RichTextDoc, signal: AbortSignal) { return imageDrafts.prepare(body, signal); }
    export function resetImageUploads() { imageDrafts.resetUploads(); }

    function openImage() {
        imageUrl = ""; imageAlt = ""; imageError = ""; imageOpen = true;
    }

    function validImageAlt() {
        if ([...String(imageAlt)].length <= RICH_TEXT_LIMITS.maxImageAltChars) return true;
        imageError = "图片说明最多 300 个字符。";
        return false;
    }

    function insertImageNodes(images: { src: string; alt: string | null }[], position?: number) {
        const instance = editor;
        if (!instance || disabled || !images.length) return;
        const nodes = images.map(attrs => ({ type: "image", attrs }));
        instance.view.dispatch(closeHistory(instance.state.tr));
        instance.chain().focus().insertContentAt(position ?? instance.state.selection, nodes)
            .command(({ tr }) => { cursorAfterImage(tr); return true; }).run();
        instance.view.dispatch(closeHistory(instance.state.tr));
    }

    function insertImageUrl() {
        const src = normalizeHref(String(imageUrl));
        if (!src) { imageError = "请输入有效的 HTTP(S) 图片地址或站内路径。"; return; }
        if (!validImageAlt()) return;
        imageOpen = false;
        insertImageNodes([{ src, alt: String(imageAlt) }]);
        imageAlt = "";
    }
    let linkOpen = $state(false);
    let linkValue = $state<string | number>("");
    let linkError = $state("");
    let mathOpen = $state(false);
    let latex = $state("");
    let mathKind = $state("inlineMath");
    let editingMath = $state.raw<ProseMirrorNode | null>(null);
    let mathBookmark: SelectionBookmark;
    let language = $state("");
    let lastPublished = "";
    const controllers = new Map<string, AbortController>();
    const uploadKey = new PluginKey<DecorationSet>("imageUploads");
    const limit = $derived(Number.isFinite(maxChars) ? Math.max(0, Math.min(RICH_TEXT_LIMITS.maxChars, Math.floor(maxChars))) : RICH_TEXT_LIMITS.maxChars);
    const overLimit = $derived(chars > limit);
    const inCodeBlock = $derived.by(() => { revision; return editor?.isActive("codeBlock") ?? false; });
    const languageOptions = [{ value: "", label: "纯文本" }, ...CODE_LANGUAGES.map((value) => ({ value, label: value === "xml" ? "xml / HTML" : value }))];
    const emptyDoc: RichTextDoc = { type: "doc", content: [{ type: "paragraph" }] };

    function publish(instance: Editor) {
        const raw = instance.getJSON();
        const result = validateDoc(raw);
        chars = countChars(raw as RichTextDoc);
        contractError = result.ok ? null : result.reason;
        const next = result.ok ? result.doc : null;
        lastPublished = JSON.stringify(next);
        value = next;
    }

    function removeUpload(uploadId: string) {
        if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: uploadId }));
        controllers.delete(uploadId);
        uploads = uploads.filter((item) => item.id !== uploadId);
    }

    function insertFiles(files: File[], position?: number, alt = "") {
        if (!editor || disabled) return;
        const images = [];
        message = "";
        for (const file of files) {
            const error = imageFileError(file);
            if (error) { message = error; continue; }
            if (uploadImage) void uploadWithAdapter(file, position);
            else images.push({ src: imageDrafts.add(file), alt: alt || [...file.name].slice(0, RICH_TEXT_LIMITS.maxImageAltChars).join("") || null });
        }
        insertImageNodes(images, position);
    }

    async function uploadWithAdapter(file: File, position?: number) {
        const instance = editor;
        if (!instance || !uploadImage || disabled) return;
        const uploadId = crypto.randomUUID();
        const controller = new AbortController();
        controllers.set(uploadId, controller);
        uploads = [...uploads, { id: uploadId, name: file.name }];
        instance.view.dispatch(instance.state.tr.setMeta(uploadKey, { add: { id: uploadId, pos: position ?? instance.state.selection.from } }));
        message = "";
        try {
            const result = await uploadImage(file, controller.signal);
            if (controller.signal.aborted || instance.isDestroyed) return;
            const src = normalizeHref(result.src);
            const image = { type: "image", attrs: { src, alt: result.alt ?? null } };
            if (!src?.startsWith("/") || !validateDoc({ type: "doc", content: [image] }).ok) throw new Error("Invalid image result");
            const placeholder = uploadKey.getState(instance.state)?.find(undefined, undefined, (spec) => spec.id === uploadId)[0];
            if (placeholder && !disabled) {
                instance.commands.insertContentAt(placeholder.from, image);
            }
        } catch {
            if (!controller.signal.aborted && !instance.isDestroyed) message = "图片上传失败，重新选择图片后重试。";
        } finally {
            removeUpload(uploadId);
        }
    }

    function cancelUpload(uploadId: string) {
        controllers.get(uploadId)?.abort();
        removeUpload(uploadId);
    }

    function attach(element: HTMLDivElement) {
        const initial = validateDoc(value);
        imageDrafts.load(initial.ok ? initial.doc : null);
        const instance = new Editor({
            element,
            content: initial.ok ? initial.doc : emptyDoc,
            editable: !disabled,
            injectCSS: false,
            extensions: createEditorExtensions({ placeholder, imagePreview: src => imageDrafts.preview(src), onError: (text) => { message = text; } }),
            editorProps: {
                attributes: { class: "rich-text editor-document", role: "textbox", "aria-multiline": "true" },
                transformPastedHTML: sanitizePastedHTML,
                handleDOMEvents: {
                    click(view, event) {
                        if (disabled || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return false;
                        const formula = event.target instanceof Element && event.target.closest("[data-latex]");
                        if (!formula) return false;
                        openMath(NodeSelection.create(view.state.doc, view.posAtDOM(formula, 0, -1)));
                        event.preventDefault();
                        return true;
                    }
                },
                handleKeyDown(view, event) {
                    if (event.isComposing || view.composing || event.keyCode === 229) return false;
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        if (!disabled) onsubmit?.();
                        return true;
                    }
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
                        event.preventDefault();
                        if (!disabled) openLink();
                        return true;
                    }
                    return false;
                },
                handlePaste(_view, event) {
                    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
                    if (!files.length) return false;
                    event.preventDefault();
                    insertFiles(files);
                    return true;
                },
                handleDrop(view, event) {
                    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
                    if (!files.length) return false;
                    event.preventDefault();
                    const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
                    insertFiles(files, position);
                    return true;
                }
            },
            onTransaction: ({ transaction, appendedTransactions }) => {
                revision += 1;
                if (!mathOpen) return;
                // A pending image upload can move the target while the dialog is open.
                for (const change of [transaction, ...appendedTransactions]) {
                    if (change.docChanged) mathBookmark = mathBookmark.map(change.mapping);
                }
            },
            onUpdate: ({ editor: current }) => publish(current),
            onSelectionUpdate: ({ editor: current }) => {
                language = current.getAttributes("codeBlock").language ?? "";
            }
        });
        instance.registerPlugin(imageDrafts.ownershipPlugin());
        instance.registerPlugin(new Plugin({
            key: uploadKey,
            state: {
                init: () => DecorationSet.empty,
                apply(transaction, decorations) {
                    let next = decorations.map(transaction.mapping, transaction.doc);
                    const action = transaction.getMeta(uploadKey);
                    if (action?.add) {
                        const widget = Decoration.widget(action.add.pos, () => {
                            const span = document.createElement("span");
                            span.className = "image-upload-placeholder";
                            span.setAttribute("role", "status");
                            span.textContent = "正在上传图片…";
                            return span;
                        }, { id: action.add.id, side: -1 });
                        next = next.add(transaction.doc, [widget]);
                    }
                    if (action?.remove) next = next.remove(next.find(undefined, undefined, (spec) => spec.id === action.remove));
                    return next;
                }
            },
            props: { decorations: (state) => uploadKey.getState(state) }
        }));
        editor = instance;
        publish(instance);
        return { destroy() {
            for (const controller of controllers.values()) controller.abort();
            controllers.clear();
            instance.destroy();
            imageDrafts.dispose();
            editor = null;
        } };
    }

    $effect(() => {
        const instance = editor;
        const incoming = JSON.stringify(value);
        if (!instance || incoming === lastPublished) return;
        const result = validateDoc(value);
        untrack(() => {
            if (value !== null && !result.ok) { message = "传入正文无法编辑。"; return; }
            mathOpen = false;
            for (const upload of uploads) cancelUpload(upload.id);
            imageDrafts.load(result.ok ? result.doc : null);
            instance.commands.setContent(result.ok ? result.doc : emptyDoc, { emitUpdate: false });
            publish(instance);
        });
    });

    $effect(() => {
        if (!editor) return;
        editor.setEditable(!disabled, false);
        const dom = editor.view.dom;
        dom.id = id;
        dom.setAttribute("aria-label", "正文");
        const labelledBy = labelId ?? (document.getElementById(`${id}-label`) ? `${id}-label` : undefined);
        if (labelledBy) { dom.setAttribute("aria-labelledby", labelledBy); dom.removeAttribute("aria-label"); }
        else dom.removeAttribute("aria-labelledby");
        const description = [describedBy, (chars >= limit * 0.8 || contractError) && `${id}-counter`, message && `${id}-message`].filter(Boolean).join(" ");
        if (description) dom.setAttribute("aria-describedby", description);
        else dom.removeAttribute("aria-describedby");
        dom.setAttribute("aria-invalid", String(invalid || overLimit || Boolean(contractError)));
        dom.setAttribute("aria-disabled", String(disabled));
    });

    $effect(() => {
        onstatechange?.({ chars, valid: !overLimit && !contractError && uploads.length === 0,
            reason: contractError ?? (overLimit ? "超过字符上限" : null), uploading: uploads.length });
    });

    function openLink() {
        linkValue = editor?.getAttributes("link").href ?? "";
        linkError = "";
        linkOpen = true;
    }
    function applyLink() {
        const href = normalizeHref(String(linkValue));
        if (!href) { linkError = "输入 http、https 地址或以 / 开头的站内路径。"; return; }
        if (!disabled) {
            const chain = editor?.chain().focus().extendMarkRange("link");
            if (editor?.state.selection.empty && !editor.isActive("link")) chain?.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
            else chain?.setLink({ href }).run();
        }
        linkOpen = false;
    }
    function isMath(node: ProseMirrorNode) {
        return node.type.name === "inlineMath" || node.type.name === "blockMath";
    }
    function openMath(selection: Selection) {
        const node = selection.$from.nodeAfter;
        editingMath = node && isMath(node) && selection.to === selection.from + node.nodeSize ? node : null;
        mathBookmark = (editingMath ? new NodeSelection(selection.$from) : selection).getBookmark();
        latex = editingMath?.attrs.latex ?? "";
        mathKind = editingMath?.type.name ?? "inlineMath";
        mathOpen = true;
    }
    async function applyMath() {
        const current = editor;
        if (!current || disabled || Array.from(latex).length > RICH_TEXT_LIMITS.maxLatexChars) return;
        const selection = mathBookmark.resolve(current.state.doc);
        if (editingMath && (!(selection instanceof NodeSelection) || selection.node !== editingMath)) {
            message = "原公式已更改，请重新打开编辑。";
            mathOpen = false;
            return;
        }
        const type = current.schema.nodes[mathKind];
        const formula = type.create({ latex }, null, type.isInline ? editingMath?.marks : undefined);
        const tr = closeHistory(current.state.tr).setSelection(selection).replaceSelectionWith(formula, false);
        if (formula.isBlock && tr.selection instanceof NodeSelection) {
            // At a block boundary, typing would replace the selected formula or its neighbor.
            const after = tr.selection.node === formula ? tr.selection.to : tr.selection.from;
            tr.insert(after, current.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
        }
        mathOpen = false;
        current.view.dispatch(tr.scrollIntoView());
        await tick();
        if (!current.isDestroyed && !disabled) current.view.focus();
    }

    const buttons = $derived.by(() => {
        revision;
        const current = editor;
        const common = [
            { label: "加粗", shortcut: "Ctrl/⌘+B", icon: Bold, active: current?.isActive("bold"), run: () => current?.chain().focus().toggleBold().run() },
            { label: "斜体", shortcut: "Ctrl/⌘+I", icon: Italic, active: current?.isActive("italic"), run: () => current?.chain().focus().toggleItalic().run() },
            { label: "删除线", shortcut: "Ctrl/⌘+Shift+S", icon: Strikethrough, active: current?.isActive("strike"), run: () => current?.chain().focus().toggleStrike().run() },
            { label: "行内代码", shortcut: "Ctrl/⌘+E", icon: Code, active: current?.isActive("code"), run: () => current?.chain().focus().toggleCode().run() },
            { label: "链接", shortcut: "Ctrl/⌘+K", icon: LinkIcon, active: current?.isActive("link"), run: openLink },
            { label: "代码块", shortcut: "Ctrl/⌘+Alt+C", icon: Braces, active: current?.isActive("codeBlock"), run: () => current?.chain().focus().toggleCodeBlock().run() },
            { label: "插入图片", shortcut: "", icon: ImagePlus, active: undefined, run: openImage },
            { label: "公式", shortcut: "", icon: Sigma, active: undefined, run: () => { if (current) openMath(current.state.selection); } }
        ];
        if (toolbar === "compact") return common;
        return [...common,
            { label: "二级标题", shortcut: "Ctrl/⌘+Alt+2", icon: Heading2, active: current?.isActive("heading", { level: 2 }), run: () => current?.chain().focus().toggleHeading({ level: 2 }).run() },
            { label: "三级标题", shortcut: "Ctrl/⌘+Alt+3", icon: Heading3, active: current?.isActive("heading", { level: 3 }), run: () => current?.chain().focus().toggleHeading({ level: 3 }).run() },
            { label: "四级标题", shortcut: "Ctrl/⌘+Alt+4", icon: Heading4, active: current?.isActive("heading", { level: 4 }), run: () => current?.chain().focus().toggleHeading({ level: 4 }).run() },
            { label: "无序列表", shortcut: "Ctrl/⌘+Shift+8", icon: List, active: current?.isActive("bulletList"), run: () => current?.chain().focus().toggleBulletList().run() },
            { label: "有序列表", shortcut: "Ctrl/⌘+Shift+7", icon: ListOrdered, active: current?.isActive("orderedList"), run: () => current?.chain().focus().toggleOrderedList().run() },
            { label: "引用", shortcut: "Ctrl/⌘+Shift+B", icon: Quote, active: current?.isActive("blockquote"), run: () => current?.chain().focus().toggleBlockquote().run() },
            { label: "分隔线", shortcut: "", icon: Minus, active: undefined, run: () => current?.chain().focus().setHorizontalRule().run() },
            { label: "撤销", shortcut: "Ctrl/⌘+Z", icon: Undo2, active: undefined, run: () => current?.chain().focus().undo().run() },
            { label: "重做", shortcut: "Ctrl/⌘+Shift+Z", icon: Redo2, active: undefined, run: () => current?.chain().focus().redo().run() }
        ];
    });

    function toolbarKeys(event: KeyboardEvent) {
        if (!(event.currentTarget instanceof HTMLElement) || !(event.target instanceof HTMLButtonElement)) return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = controls.indexOf(event.target);
        let next = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % controls.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + controls.length) % controls.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = controls.length - 1;
        else return;
        event.preventDefault();
        activeButton = next;
        controls[next]?.focus();
    }
</script>

<div class="editor" class:invalid={invalid || overLimit || Boolean(contractError)} class:disabled>
    <div class="toolbar" role="toolbar" tabindex="-1" aria-label={toolbar === "compact" ? "评论格式" : "正文格式"} onkeydown={toolbarKeys}>
        {#each buttons as button, index (button.label)}
            <Button iconOnly variant="ghost" size="sm" aria-label={button.label} aria-pressed={button.active}
                title={`${button.label}${button.shortcut ? `（${button.shortcut}）` : ""}`} disabled={disabled || !editor}
                tabindex={index === activeButton ? 0 : -1} onfocus={() => { activeButton = index; }} onclick={button.run}>
                <button.icon size="1em" aria-hidden="true" />
            </Button>
        {/each}
    </div>
    {#if inCodeBlock}
        <div class="language"><Select aria-label="代码语言" options={languageOptions} bind:value={language} {disabled}
            onchange={(event) => editor?.chain().focus().updateAttributes("codeBlock", { language: event.currentTarget.value || null }).run()} /></div>
    {/if}
    <div class="mount" use:attach></div>
    <input class="file-input" tabindex="-1" aria-hidden="true" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple bind:this={imageInput}
        onchange={(event) => { insertFiles(Array.from(event.currentTarget.files ?? []), undefined, String(imageAlt)); imageAlt = ""; event.currentTarget.value = ""; }} />
</div>
{#if chars >= limit * 0.8 || contractError}
    <p class="counter" class:danger={overLimit || Boolean(contractError)} id={`${id}-counter`} aria-live="polite">
        {chars} / {limit}{#if contractError} · 正文超出限制或格式无效{/if}
    </p>
{/if}
{#if message}<p class="message" id={`${id}-message`} role="alert">{message}</p>{/if}
{#if uploads.length}
    <ul class="uploads" aria-label="正在上传的图片">
        {#each uploads as upload (upload.id)}<li><span>{upload.name} · 正在上传</span><Button size="sm" onclick={() => cancelUpload(upload.id)}>取消上传</Button></li>{/each}
    </ul>
{/if}

<Dialog bind:open={imageOpen} title="插入图片">
    <Field label="图片 URL" error={imageError}>
        {#snippet children(control)}<TextInput id={control.id} aria-describedby={control.describedBy} invalid={control.invalid} bind:value={imageUrl} placeholder="https://example.com/image.png"
            onkeydown={event => { if (!event.isComposing && event.key === "Enter") insertImageUrl(); }} />{/snippet}
    </Field>
    <Field label="图片说明（可选）">
        {#snippet children({ id })}<TextInput {id} bind:value={imageAlt} />{/snippet}
    </Field>
    <p class="image-help">本地图片支持 PNG、JPEG、GIF 和 WebP，每张最大 1 MiB。</p>
    {#snippet actions()}
        <Button disabled={disabled} onclick={() => { if (validImageAlt()) { imageOpen = false; imageInput.click(); } }}>选择本地图片</Button>
        <Button variant="primary" disabled={disabled || !String(imageUrl).trim()} onclick={insertImageUrl}>插入 URL 图片</Button>
    {/snippet}
</Dialog>

<Dialog bind:open={linkOpen} title="插入链接">
    <Field label="链接地址" error={linkError}>
        {#snippet children(control)}<TextInput id={control.id} aria-describedby={control.describedBy} invalid={control.invalid} bind:value={linkValue} placeholder="https://example.com 或 /courses" onkeydown={(event) => { if (!event.isComposing && event.key === "Enter") applyLink(); }} />{/snippet}
    </Field>
    {#snippet actions()}
        <Button variant="ghost" disabled={disabled} onclick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); linkOpen = false; }}>移除链接</Button>
        <Button variant="primary" disabled={disabled} onclick={applyLink}>应用链接</Button>
    {/snippet}
</Dialog>
<Dialog bind:open={mathOpen} title={editingMath ? "编辑公式" : "插入公式"}>
    <Field label="公式位置">{#snippet children(control)}<Select id={control.id} bind:value={mathKind} options={[{ value: "inlineMath", label: "行内公式" }, { value: "blockMath", label: "独立公式" }]} />{/snippet}</Field>
    <Field label="LaTeX 公式" help={`最多 ${RICH_TEXT_LIMITS.maxLatexChars} 个字符`} error={Array.from(latex).length > RICH_TEXT_LIMITS.maxLatexChars ? "公式超出长度上限" : undefined}>
        {#snippet children(control)}<Textarea id={control.id} aria-describedby={control.describedBy} invalid={control.invalid} autofocus bind:value={latex} />{/snippet}
    </Field>
    {#if mathOpen}<div class="rich-text math-preview"><MathPreview {latex} display={mathKind === "blockMath"} /></div>{/if}
    {#snippet actions()}<Button variant="primary" disabled={disabled || Array.from(latex).length > RICH_TEXT_LIMITS.maxLatexChars} onclick={applyMath}>{editingMath ? "保存修改" : "插入公式"}</Button>{/snippet}
</Dialog>

<style>
    .image-help { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .editor { min-width: 0; border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); overflow: clip; }
    .editor:focus-within { border-color: var(--color-accent); }
    .editor.invalid { border-color: var(--color-danger); }
    .editor.disabled { opacity: 0.6; }
    .toolbar { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-2); border-bottom: 1px solid var(--color-border); }
    .editor .toolbar :global(button[aria-pressed="true"]) { background: var(--color-accent-soft); color: var(--color-accent-soft-text); }
    .mount { min-width: 0; }
    .mount :global(.editor-document) { padding: var(--space-4); min-height: calc(var(--space-12) * 3); outline: none; white-space: pre-wrap; }
    .mount :global(.editor-document:focus-visible) { outline: 2px solid var(--color-focus-ring); outline-offset: -2px; }
    .mount :global(.editor-image) { position: relative; width: fit-content; max-width: 100%; min-height: var(--space-8); }
    .mount :global(.editor-image-preview) { position: relative; border-radius: var(--radius-md); }
    .mount :global(.editor-document[contenteditable="true"]:focus-within .editor-image-selected > .editor-image-preview::after) {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--color-selection);
        opacity: 0.6;
        pointer-events: none;
    }
    .mount :global(.editor-image-remove) {
        position: absolute;
        inset-block-start: var(--space-1);
        /* Keep the center of small images available for selection. */
        inset-inline-start: max(60%, calc(100% - var(--space-8) - var(--space-1)));
        display: grid;
        place-items: center;
        width: var(--space-8);
        height: var(--space-8);
        padding: 0;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        color: var(--color-danger);
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
    }
    .mount :global(.editor-image:is(:hover, :focus-within, .ProseMirror-selectednode) > .editor-image-remove) { opacity: 1; pointer-events: auto; }
    .mount :global(.editor-image-remove:hover) { background: var(--color-danger-soft); color: var(--color-danger-soft-text); }
    .mount :global([contenteditable="false"].editor-document .editor-image-remove) { display: none; }
    /* ProseMirror uses a zero-width inline image to position the caret after a final inline atom. */
    .mount :global(img.ProseMirror-separator) { display: inline; width: 0; height: 0; }
    .mount :global([contenteditable="true"] [data-latex]) { cursor: pointer; }
    .mount :global([data-latex] .katex-html:empty)::before { content: "空公式"; color: var(--color-text-muted); }
    .mount :global(.is-editor-empty:first-child::before) { content: attr(data-placeholder); float: left; color: var(--color-text-muted); pointer-events: none; height: 0; }
    .mount :global(.image-upload-placeholder) { display: inline-block; padding: var(--space-2); border: 1px dashed var(--color-border-strong); color: var(--color-text-secondary); }
    .language { width: min(100%, calc(var(--space-12) * 5)); padding: var(--space-2); }
    .file-input { display: none; }
    .counter, .message { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-top: var(--space-1); overflow-wrap: anywhere; }
    .danger, .message { color: var(--color-danger); }
    .uploads { display: grid; gap: var(--space-2); list-style: none; padding: var(--space-2) 0; }
    .uploads li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
    .uploads span { overflow-wrap: anywhere; min-width: 0; }
    .math-preview { overflow: auto; padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
</style>