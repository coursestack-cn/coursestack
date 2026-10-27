<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    import type { UploadSnapshot } from "../../files/types";

    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        snapshot: UploadSnapshot<unknown>;
        oncancel?: () => void;
        onretry?: () => void;
        onremove?: () => void;
        oncontinueDuplicate?: () => void;
    };
</script>

<script lang="ts">
    import { Check, RotateCcw, X, Trash2 } from "@lucide/svelte";
    import Button from "../ui/Button.svelte";
    import FileIcon from "./FileIcon.svelte";
    import { formatBytes } from "../../files/format-bytes";

    const generatedId = $props.id();
    let { snapshot, oncancel, onretry, onremove, oncontinueDuplicate, class: className = "", ...rest }: Props = $props();
    const name = $derived(snapshot.file?.name ?? "尚未选择文件");
    const filename = $derived.by(() => {
        const dot = name.lastIndexOf(".");
        const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot) : "";
        const stem = Array.from(extension ? name.slice(0, dot) : name);
        return stem.length > 16
            ? { head: stem.slice(0, -8).join(""), tail: stem.slice(-8).join(""), extension }
            : { head: stem.join(""), tail: "", extension };
    });
    const percentage = $derived(snapshot.total > 0 && Number.isFinite(snapshot.loaded)
        ? Math.min(100, Math.max(0, Math.floor(snapshot.loaded / snapshot.total * 100))) : 0);
    const active = $derived(["validating", "preparing", "uploading", "confirming", "awaiting-duplicate"].includes(snapshot.status));
    const indeterminate = $derived(["validating", "preparing", "confirming"].includes(snapshot.status));
    const progressValue = $derived(indeterminate ? undefined : snapshot.status === "done" ? 100 : percentage);
    const showPercentage = $derived(snapshot.status === "uploading" || snapshot.status === "done"
        || (snapshot.status === "failed" && (snapshot.failure?.stage === "uploading" || snapshot.failure?.stage === "confirming")));
    const status = $derived.by(() => {
        switch (snapshot.status) {
            case "idle": return "等待上传";
            case "validating": return "正在检查文件";
            case "preparing": return "正在准备上传";
            case "awaiting-duplicate": return "发现相同文件";
            case "uploading": return "正在上传";
            case "confirming": return "文件已上传，正在确认";
            case "done": return "上传完成";
            case "cancelled": return "已取消";
            case "failed": return ({ validating: "文件检查失败", preparing: "准备上传失败", uploading: "上传失败", confirming: "确认失败" })[snapshot.failure?.stage ?? "uploading"];
        }
    });
</script>

<div {...rest} class={`upload-item ${className}`} class:failed={snapshot.status === "failed"} aria-busy={(active && snapshot.status !== "awaiting-duplicate") || undefined}>
    <div class="file">
        <FileIcon name={snapshot.file?.name ?? ""} mime={snapshot.file?.type} iconSize="1.5em" />
        <div class="details">
            <p class="filename" title={name}><span class="sr-only">{name}</span><span class="head" aria-hidden="true">{filename.head}</span><span class="tail" aria-hidden="true">{filename.tail}</span><span class="extension" aria-hidden="true">{filename.extension}</span></p>
            <p class="size">{formatBytes(snapshot.file?.size ?? 0)}</p>
        </div>
        {#if snapshot.status === "done"}<Check class="done" size="1.25em" aria-hidden="true" />{/if}
    </div>
    <div class="progress-heading"><p id={`${generatedId}-status`} role="status" aria-live="polite">{status}</p>
        {#if showPercentage}<span aria-hidden="true">{snapshot.status === "done" ? 100 : percentage}%</span>{/if}
    </div>
    <progress max="100" value={progressValue} aria-label={`${name} 上传进度`} aria-describedby={`${generatedId}-status`}></progress>
    {#if snapshot.status === "uploading"}<p class="bytes">{formatBytes(snapshot.loaded)} / {formatBytes(snapshot.total)}</p>{/if}
    {#if snapshot.status === "failed"}<p class="failure" role="alert">{snapshot.failure?.message ?? "上传未完成，重试后继续。"}</p>{/if}
    {#if snapshot.status === "awaiting-duplicate"}
        <p class="duplicate">已存在相同文件，仍要继续上传吗？</p>
        {#if snapshot.duplicate?.name}<p class="duplicate-name">已有文件：{snapshot.duplicate.name}</p>{/if}
    {/if}
    {#if (active && oncancel) || ((snapshot.status === "failed" || snapshot.status === "cancelled") && onretry) || (!active && onremove) || (snapshot.status === "awaiting-duplicate" && oncontinueDuplicate)}
        <div class="actions">
            {#if snapshot.status === "awaiting-duplicate" && oncontinueDuplicate}<Button size="sm" variant="primary" onclick={oncontinueDuplicate}>继续上传</Button>{/if}
            {#if active && oncancel}<Button size="sm" variant="ghost" onclick={oncancel}>{#snippet icon()}<X size="1em" />{/snippet}取消上传</Button>{/if}
            {#if (snapshot.status === "failed" || snapshot.status === "cancelled") && onretry}<Button size="sm" onclick={onretry}>{#snippet icon()}<RotateCcw size="1em" />{/snippet}重试</Button>{/if}
            {#if !active && onremove}<Button size="sm" variant="ghost" onclick={onremove}>{#snippet icon()}<Trash2 size="1em" />{/snippet}移除</Button>{/if}
        </div>
    {/if}
</div>

<style>
    .upload-item { display: grid; gap: var(--space-2); min-width: 0; padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .upload-item.failed { border-color: var(--color-danger); }
    .file { display: flex; align-items: center; min-width: 0; gap: var(--space-3); }
    .file > :global(.file-icon), .file > :global(svg) { flex-shrink: 0; }
    .details { min-width: 0; flex: 1; }
    .filename { display: flex; min-width: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-bold); }
    .head { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tail { min-width: 0; max-width: 40%; overflow: hidden; white-space: nowrap; }
    .extension { flex-shrink: 0; max-width: 55%; overflow-wrap: anywhere; }
    .size, .bytes, .progress-heading, .failure, .duplicate, .duplicate-name { font-size: var(--font-size-sm); overflow-wrap: anywhere; }
    .size, .bytes, .progress-heading, .duplicate-name { color: var(--color-text-secondary); }
    .progress-heading { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
    .progress-heading > span { flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .failure { color: var(--color-danger); }
    .done { color: var(--color-success); }
    progress { display: block; width: 100%; height: var(--space-2); border: 0; border-radius: var(--radius-full); overflow: hidden; background: var(--color-surface-sunken); accent-color: var(--color-accent); }
    progress::-webkit-progress-bar { background: var(--color-surface-sunken); border-radius: var(--radius-full); }
    progress::-webkit-progress-value { background: var(--color-accent); border-radius: var(--radius-full); }
    progress::-moz-progress-bar { background: var(--color-accent); border-radius: var(--radius-full); }
    .actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    @media (max-width: 639px) { .upload-item { padding: var(--space-3); } }
</style>