<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        name: string;
        mime?: string;
        size: number;
        version?: number | string;
        updatedAt?: number | null;
        downloadHref?: string;
    };
</script>

<script lang="ts">
    import { Download } from "@lucide/svelte";
    import Button from "../ui/Button.svelte";
    import RelativeTime from "../content/RelativeTime.svelte";
    import FileIcon from "./FileIcon.svelte";
    import { formatBytes } from "../../files/format-bytes";
    import { fileTypeLabel } from "../../files/validation";
    import { safeDownloadHref } from "../../files/urls";

    let { name, mime = "", size, version, updatedAt, downloadHref, class: className = "", ...rest }: Props = $props();
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
            {#if updatedAt !== undefined && updatedAt !== null}<div><dt>更新于</dt><dd><RelativeTime timestamp={updatedAt} /></dd></div>{/if}
        </dl>
    </div>
    {#if href}
        <div class="download"><Button {href} download={name} target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer nofollow" : undefined} aria-label={`下载 ${name}${external ? "（在新标签页打开）" : ""}`}>
            {#snippet icon()}<Download size="1em" />{/snippet}下载
        </Button></div>
    {/if}
</div>

<style>
    .file-info { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); min-width: 0; padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    .details { flex: 1 1 min(100%, calc(var(--space-12) * 3)); min-width: 0; }
    .name { font-size: var(--font-size-md); font-weight: var(--font-weight-bold); overflow-wrap: anywhere; }
    dl { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin-block-start: var(--space-1); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    dl > div { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); min-width: 0; }
    dt, dd { overflow-wrap: anywhere; }
    .download { max-width: 100%; margin-inline-start: auto; }
</style>