<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    /** Local blob URLs must come from createPreviewUrl; their owner revokes them after use. */
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        src: string;
        name: string;
        mime: string;
        size: number;
        downloadHref?: string;
    };
</script>

<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { Download, ExternalLink, Maximize2, RotateCw } from "@lucide/svelte";
    import Dialog from "../ui/Dialog.svelte";
    import Button from "../ui/Button.svelte";
    import Spinner from "../ui/Spinner.svelte";
    import StateBlock from "../ui/StateBlock.svelte";
    import FileInfo from "./FileInfo.svelte";
    import { classifyFile } from "../../files/validation";
    import { isInlinePreviewUrl, safeDownloadHref } from "../../files/urls";

    let { src, name, mime, size, downloadHref, class: className = "", ...rest }: Props = $props();
    let pdfEnabled = $state(false);
    let loading = $state(true);
    let failed = $state(false);
    let originalFailed = $state(false);
    let originalOpen = $state(false);
    let naturalWidth = $state(0);
    let naturalHeight = $state(0);
    let retryCount = $state(0);
    let alive = true;
    const imageMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    const kind = $derived(classifyFile(name, mime));
    const mediaType = $derived(mime.split(";", 1)[0]!.trim().toLowerCase());
    const source = $derived(isInlinePreviewUrl(src) ? src : null);
    const mode = $derived(source && kind === "image" && imageMimes.has(mediaType) ? "image"
        : source && kind === "pdf" && mediaType === "application/pdf" && pdfEnabled ? "pdf" : "info");
    const key = $derived(JSON.stringify([source, name, mime, mode, retryCount]));
    const download = $derived(downloadHref ? safeDownloadHref(downloadHref) : null);
    const externalDownload = $derived(Boolean(download && !download.startsWith("/") && !download.startsWith("blob:")));
    const fallbackMessage = $derived(source && kind === "pdf" && mediaType === "application/pdf" && !pdfEnabled
        ? "当前浏览器无法预览此 PDF，下载后查看。" : "此文件暂不支持在线预览，下载后查看。");

    onMount(() => { pdfEnabled = navigator.pdfViewerEnabled === true; });
    onDestroy(() => { alive = false; });
    $effect(() => {
        key;
        loading = true;
        failed = false;
        originalFailed = false;
        originalOpen = false;
        naturalWidth = 0;
        naturalHeight = 0;
    });

    function imageLoaded(event: Event, expected: string) {
        if (!alive || expected !== key || !(event.currentTarget instanceof HTMLImageElement)) return;
        const image = event.currentTarget;
        if (!image.naturalWidth || !image.naturalHeight) { fail(expected); return; }
        naturalWidth = image.naturalWidth;
        naturalHeight = image.naturalHeight;
        loading = false;
    }

    function pdfLoaded(event: Event, expected: string) {
        if (!alive || expected !== key || !(event.currentTarget instanceof HTMLIFrameElement)) return;
        try {
            const document = event.currentTarget.contentDocument;
            // Same-origin HTML/JSON error responses are observable. Native viewer internals may not be.
            if (document && document.contentType !== "application/pdf" && !document.querySelector('embed[type="application/pdf"]')) {
                fail(expected);
                return;
            }
        } catch {
            // Browser PDF viewers may live in an isolated extension origin.
        }
        loading = false;
    }

    function fail(expected: string) {
        if (!alive || expected !== key) return;
        failed = true;
        loading = false;
        originalOpen = false;
    }
</script>

<div {...rest} class={`file-preview ${className}`}>
    <FileInfo {name} {mime} {size} {downloadHref} />
    {#if mode === "info"}
        <p class="fallback">{fallbackMessage}</p>
    {:else if failed}
        <StateBlock kind="error" compact title="预览加载失败" description="暂时无法显示文件，下载后查看或重试。">
            {#snippet actions()}<Button onclick={() => { retryCount += 1; }}>{#snippet icon()}<RotateCw size="1em" />{/snippet}重试预览</Button>{/snippet}
        </StateBlock>
    {:else}
        {#key key}
            {@const current = key}
            {#if mode === "image" && source}
                <div class="image-stage" aria-busy={loading || undefined}>
                    <button type="button" class="image-button" disabled={loading} onclick={() => { originalOpen = true; }} aria-label={`查看原始尺寸：${name}`}>
                        <img src={source} alt={name} decoding="async" onload={(event) => imageLoaded(event, current)} onerror={() => fail(current)} />
                    </button>
                    {#if loading}<div class="loading"><Spinner label="正在加载图片" /><span>正在加载图片</span></div>{/if}
                </div>
                <p class="image-hint"><Maximize2 size="1em" aria-hidden="true" />点击图片查看原始尺寸</p>
            {:else if mode === "pdf" && source}
                <div class="pdf-stage" aria-busy={loading || undefined}>
                    <iframe title={`${name} PDF 预览`} src={source} onload={(event) => pdfLoaded(event, current)} onerror={() => fail(current)}></iframe>
                    {#if loading}<div class="loading"><Spinner label="正在加载 PDF" /><span>正在加载 PDF</span></div>{/if}
                </div>
                <div class="pdf-actions"><Button href={source} target="_blank" rel="noopener noreferrer" aria-label={`在新标签页打开 ${name}`}>
                    {#snippet icon()}<ExternalLink size="1em" />{/snippet}在新标签页打开
                </Button></div>
            {/if}
        {/key}
    {/if}
    {#if mode === "image" && source}
        <Dialog bind:open={originalOpen} title={`原始尺寸：${name}`} description={naturalWidth ? `${naturalWidth} × ${naturalHeight} 像素，可滚动查看。` : "可滚动查看完整图片。"}>
            {#if originalOpen}
                {#if originalFailed}
                    <StateBlock kind="error" compact title="图片加载失败" description="下载后查看完整图片。" />
                {:else}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to focus and scroll the original-size image region.) -->
                    <div class="original-scroll" role="region" tabindex="0" aria-label="原始尺寸图片，可横向和纵向滚动">
                        {#key key}
                            {@const current = key}
                            <img src={source} alt={name} width={naturalWidth || undefined} height={naturalHeight || undefined}
                                onerror={() => { if (alive && current === key) originalFailed = true; }} />
                        {/key}
                    </div>
                {/if}
            {/if}
            {#snippet actions()}
                {#if download}<Button href={download} download={name} target={externalDownload ? "_blank" : undefined}
                    rel={externalDownload ? "noopener noreferrer nofollow" : undefined}>
                    {#snippet icon()}<Download size="1em" />{/snippet}下载
                </Button>{/if}
                <Button onclick={() => { originalOpen = false; }}>关闭</Button>
            {/snippet}
        </Dialog>
    {/if}
</div>

<style>
    .file-preview { display: grid; gap: var(--space-3); min-width: 0; }
    .fallback, .image-hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); overflow-wrap: anywhere; }
    .image-hint { display: flex; align-items: center; justify-content: center; gap: var(--space-2); }
    .image-hint :global(svg) { flex-shrink: 0; }
    .image-stage, .pdf-stage { position: relative; min-width: 0; overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-sunken); }
    .image-button { display: grid; place-items: center; width: 100%; min-width: 0; min-height: calc(var(--space-12) * 3); padding: var(--space-3); border: 0; background: none; cursor: zoom-in; }
    .image-button:disabled { cursor: wait; }
    .image-button:focus-visible { outline-offset: calc(var(--space-1) * -1); }
    .image-button img { display: block; max-width: 100%; max-height: 60vh; width: auto; height: auto; object-fit: contain; }
    .loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: var(--space-2); pointer-events: none; color: var(--color-text-secondary); background: var(--color-surface-sunken); font-size: var(--font-size-sm); }
    .pdf-stage iframe { display: block; width: 100%; height: 80vh; border: 0; background: var(--color-surface); }
    .pdf-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2); }
    .original-scroll { min-width: 0; max-width: 100%; max-height: 60vh; overflow: auto; border: 1px solid var(--color-border); background: var(--color-surface-sunken); }
    .original-scroll img { display: block; max-width: none; max-height: none; width: auto; height: auto; }
</style>