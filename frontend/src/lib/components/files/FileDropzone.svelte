<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children" | "onchange"> & {
        accept?: string;
        multiple?: boolean;
        disabled?: boolean;
        maxBytes?: number;
        onfiles: (files: File[]) => void;
    };
</script>

<script lang="ts">
    import { UploadCloud } from "@lucide/svelte";
    import { SUPPORTED_FILE_ACCEPT, matchesAccept } from "../../files/validation";
    import { formatBytes } from "../../files/format-bytes";

    const generatedId = $props.id();
    let { accept = SUPPORTED_FILE_ACCEPT, multiple = false, disabled = false, maxBytes, onfiles,
        class: className = "", ondragenter, ondragover, ondragleave, ondrop, ...rest }: Props = $props();
    let input: HTMLInputElement;
    let dragging = $state(false);
    let message = $state("");
    let dragDepth = 0;
    const allowed = $derived(accept === SUPPORTED_FILE_ACCEPT || !accept.trim()
        ? "支持 PDF、PNG/JPEG/WebP/GIF、Word、Excel、PowerPoint 和 ZIP。"
        : `允许选择：${accept.split(",").map((entry) => entry.trim()).filter(Boolean).join("、")}。`);
    const instructions = $derived(`${allowed}${maxBytes !== undefined && Number.isFinite(maxBytes) ? ` 每个文件不超过 ${formatBytes(maxBytes)}。` : ""}`);

    $effect(() => { if (disabled) { dragging = false; dragDepth = 0; } });

    function hasFiles(event: DragEvent): boolean {
        return Array.from(event.dataTransfer?.types ?? []).includes("Files");
    }

    function select(files: File[]) {
        dragging = false;
        dragDepth = 0;
        if (disabled || files.length === 0) return;
        if (!multiple && files.length > 1) { message = "一次选择一个文件。每个资料版本只包含一个文件。"; return; }
        const unsupported = files.find((file) => !matchesAccept(file, accept));
        if (unsupported) { message = `“${unsupported.name}”的文件类型不受支持。${instructions}`; return; }
        const empty = files.find((file) => file.size === 0);
        if (empty) { message = `“${empty.name}”是空文件，选择包含内容的文件后重试。${instructions}`; return; }
        const tooLarge = maxBytes === undefined ? undefined : files.find((file) => file.size > maxBytes);
        if (tooLarge) { message = `“${tooLarge.name}”超过大小上限。${instructions}`; return; }
        message = "";
        onfiles(files);
    }
</script>

<div {...rest} class={`file-dropzone ${className}`} class:dragging class:disabled
    ondragenter={(event) => {
        ondragenter?.(event);
        if (!hasFiles(event) || event.defaultPrevented) return;
        event.preventDefault();
        if (disabled) return;
        dragDepth++;
        dragging = true;
    }} ondragover={(event) => {
        ondragover?.(event);
        if (!hasFiles(event) || event.defaultPrevented) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    }} ondragleave={(event) => {
        ondragleave?.(event);
        if (!hasFiles(event)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) dragging = false;
    }} ondrop={(event) => {
        ondrop?.(event);
        if (!hasFiles(event) || event.defaultPrevented) return;
        event.preventDefault();
        select(Array.from(event.dataTransfer?.files ?? []));
    }}>
    <button class="choose" type="button" {disabled} aria-label={multiple ? "选择上传文件，可多选" : "选择上传文件"}
        aria-describedby={`${generatedId}-help${message ? ` ${generatedId}-error` : ""}`} onclick={() => input.click()}>
        <UploadCloud size="1.8em" aria-hidden="true" />
        <span class="title">{dragging ? "松开鼠标添加文件" : "将文件拖到这里，或点击选择"}</span>
        <span class="hint">{multiple ? "可以选择多个文件，逐个管理上传。" : "每个资料版本选择一个文件。"}</span>
    </button>
    <input bind:this={input} type="file" {accept} {multiple} {disabled} hidden tabindex="-1" aria-hidden="true"
        onchange={(event) => { select(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
    <p class="help" id={`${generatedId}-help`}>{instructions}</p>
    {#if message}<p class="error" id={`${generatedId}-error`} role="alert">{message}</p>{/if}
</div>

<style>
    .file-dropzone { min-width: 0; padding: var(--space-4); border: 1px dashed var(--color-border-strong); border-radius: var(--radius-lg); background: var(--color-surface); transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out); }
    .file-dropzone.dragging { border-color: var(--color-accent); background: var(--color-accent-soft); }
    .file-dropzone.disabled { opacity: 0.6; }
    .choose { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2); width: 100%; min-width: 0; min-height: calc(var(--space-12) * 2); padding: var(--space-4); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text); text-align: center; cursor: pointer; }
    .choose:hover:not(:disabled) { background: var(--color-surface-sunken); }
    .choose:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    .choose:disabled { cursor: not-allowed; }
    .choose :global(svg) { color: var(--color-accent); flex-shrink: 0; }
    .title { font-size: var(--font-size-base); font-weight: var(--font-weight-bold); overflow-wrap: anywhere; }
    .hint, .help, .error { font-size: var(--font-size-sm); overflow-wrap: anywhere; }
    .hint, .help { color: var(--color-text-secondary); }
    .help { margin-top: var(--space-2); }
    .error { margin-top: var(--space-2); color: var(--color-danger); }
    @media (prefers-reduced-motion: reduce) { .file-dropzone { transition: none; } }
</style>