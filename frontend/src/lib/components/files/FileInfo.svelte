<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        name: string;
        mime?: string;
        size: number;
        version?: number | string;
        updatedAt?: number | null;
        previewHref?: string;
        downloadHref?: string;
        downloadVariant?: "primary" | "secondary";
        /** Full-width row below the file details, e.g. version controls. */
        children?: Snippet;
    };
</script>

<script lang="ts">
    import { Download, ExternalLink } from "@lucide/svelte";
    import Button from "../ui/Button.svelte";
    import RelativeTime from "../content/RelativeTime.svelte";
    import FileIcon from "./FileIcon.svelte";
    import { formatBytes } from "../../files/format-bytes";
    import { fileTypeLabel } from "../../files/validation";
    import { isInlinePreviewUrl, safeDownloadHref } from "../../files/urls";

    let { name, mime = "", size, version, updatedAt, previewHref, downloadHref, downloadVariant = "secondary", children, class: className = "", ...rest }: Props = $props();
    const preview = $derived(previewHref && isInlinePreviewUrl(previewHref) ? previewHref : null);
    const href = $derived(downloadHref ? safeDownloadHref(downloadHref) : null);
    const external = $derived(Boolean(href && !href.startsWith("/") && !href.startsWith("blob:")));
</script>

<div {...rest} class={`file-info ${className}`}>
    <FileIcon {name} {mime} iconSize="2em" />
    <div class="details">
        <p class="name" title={name}>{name}</p>
        <dl>
            <div><dt>类型</dt><dd>{fileTypeLabel(name, mime)}</dd></div>
            <div><dt>大小</dt><dd>{formatBytes(size)}</dd></div>
            {#if version !== undefined}<div><dt>版本</dt><dd>{version}</dd></div>{/if}
            {#if updatedAt !== undefined && updatedAt !== null}<div><dt>上传于</dt><dd><RelativeTime timestamp={updatedAt} /></dd></div>{/if}
        </dl>
    </div>
    {#if preview || href}
        <div class="actions">
            {#if preview}<Button href={preview} target="_blank" rel="noopener noreferrer" aria-label={`在新标签页打开 ${name}`}>
                {#snippet icon()}<ExternalLink size="1em" />{/snippet}在新标签页打开
            </Button>{/if}
            {#if href}<Button variant={downloadVariant} {href} download={name} target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer nofollow" : undefined} aria-label={`下载 ${name}${external ? "（在新标签页打开）" : ""}`}>
                {#snippet icon()}<Download size="1em" />{/snippet}下载
            </Button>{/if}
        </div>
    {/if}
    {#if children}<div class="extra">{@render children()}</div>{/if}
</div>

<style>
    .file-info { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); min-width: 0; padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    .details { flex: 1 1 min(100%, calc(var(--space-12) * 3)); min-width: 0; }
    .name { font-size: var(--font-size-md); font-weight: var(--font-weight-bold); overflow-wrap: anywhere; }
    dl { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin-block-start: var(--space-1); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    dl > div { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); min-width: 0; }
    dt, dd { overflow-wrap: anywhere; }
    .actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2); max-width: 100%; margin-inline-start: auto; }
    .extra { flex: 1 1 100%; min-width: 0; padding-block-start: var(--space-3); border-top: 1px solid var(--color-border); }
</style>