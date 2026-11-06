<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { api, ApiError } from "$lib/api/client";
    import { userMessage } from "$lib/api/errors";
    import { resource } from "$lib/api/resource.svelte";
    import { session } from "$lib/session.svelte";
    import { navigate, router, setTitle, updateQuery } from "$lib/router/router.svelte";
    import { loginHref } from "$lib/router/urls";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import FilePreview from "$lib/components/files/FilePreview.svelte";
    import FileInfo from "$lib/components/files/FileInfo.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import OwnedContentPanel from "../me/OwnedContentPanel.svelte";
    import DiscussionBlock from "../questions/DiscussionBlock.svelte";
    import CommentsSection from "../questions/CommentsSection.svelte";
    import ContentState from "../questions/ContentState.svelte";
    import { courseQuestionsHref, locateContent, pageCount, type CourseEntry, type Page } from "../questions/data";
    import { materialHref, materialPath, type Material, type MaterialVersion } from "./data";

    let { material, entry, refreshing, reload }: { material: Material; entry: CourseEntry; refreshing: boolean; reload: () => void } = $props();
    let previous = $state<MaterialVersion[]>([]), historyPage = $state(1), loadingHistory = $state(false), historyError = $state("");
    let deleting = $state<MaterialVersion | null>(null), deleteOpen = $state(false);
    const controller = new AbortController();
    onDestroy(() => controller.abort());
    const selected = $derived(material.selectedVersion);
    const canOpenFile = $derived(Boolean(session.user && !material.permissions.requiresLoginForFile));
    const showVersionSelect = $derived(material.versions.total > 1);
    const showDeleteVersion = $derived(Boolean(selected && (material.permissions.canDeleteVersion || material.permissions.canEdit)));
    const hasVersionControls = $derived(showVersionSelect || material.permissions.canUploadVersion || showDeleteVersion || Boolean(historyError));
    const options = $derived.by(() => {
        const items = new Map([...material.versions.items, ...previous].map(item => [item.version, item]));
        if (selected) items.set(selected.version, selected);
        return [{ value: "", label: `最新版本${material.latestVersion ? `（${material.latestVersion.version}）` : ""}` },
            ...[...items.values()].sort((a, b) => b.version - a.version).map(item => ({ value: String(item.version), label: `版本 ${item.version}（${new Date(item.createdAt * 1000).toLocaleDateString()}）` }))];
    });
    const focus = resource(async signal => {
        const hash = router.hash, id = material.id;
        const match = /^#comment-(.+)$/.exec(hash);
        if (!match) return null;
        const location = await locateContent(decodeURIComponent(match[1]!), "comment", signal);
        if (location.root.id !== id || location.root.kind !== "material") throw new ApiError(404, "CONTENT_UNAVAILABLE", "评论不可用");
        return { commentId: location.commentId, hash };
    });
    const activeFocus = $derived(focus.data?.hash === router.hash ? focus.data : null);
    let locatedHash = "";
    let highlightedElement: HTMLElement | undefined;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    onDestroy(() => clearTimeout(highlightTimer));
    $effect(() => { setTitle(material.title); });
    $effect(() => { if (!router.hash) locatedHash = ""; });
    async function locate(repeat = false) {
        const hash = router.hash;
        if (!activeFocus || (!repeat && hash === locatedHash)) return;
        await tick();
        if (router.hash !== hash || controller.signal.aborted) return;
        const element = document.getElementById(decodeURIComponent(hash.slice(1)));
        if (!element) return;
        locatedHash = hash;
        element.scrollIntoView({ block: "nearest", behavior: "instant" });
        element.setAttribute("tabindex", "-1");
        element.focus({ preventScroll: true });
        highlightedElement?.classList.remove("material-target");
        highlightedElement = element;
        element.classList.add("material-target");
        clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => { element.classList.remove("material-target"); }, 2500);
    }
    async function older() {
        if (loadingHistory) return;
        loadingHistory = true; historyError = "";
        try {
            const page = await api.get<Page<MaterialVersion>>(`${materialPath(material.id)}/versions?page=${historyPage + 1}&pageSize=50`, { signal: controller.signal });
            previous = [...previous, ...page.items]; historyPage = page.page;
        } catch (error) { if (!controller.signal.aborted) historyError = userMessage(error); }
        finally { loadingHistory = false; }
    }
    async function removeVersion() {
        if (!deleting) return;
        await api.delete(`${materialPath(material.id)}/versions/${deleting.version}`, undefined, { signal: controller.signal });
        previous = []; historyPage = 1;
        toast.success(`已删除版本 ${deleting.version}`);
        if (router.query.has("version")) await updateQuery({ version: null }, { replace: true });
        else reload();
    }
    function removed() {
        void navigate(courseQuestionsHref(entry.course), { replace: true });
    }
    let previousPageTop: number | undefined, pendingPageDelta = 0, pageScrollFrame = 0;
    onDestroy(() => { if (pageScrollFrame) cancelAnimationFrame(pageScrollFrame); });
    function continuePageScroll(event: WheelEvent & { currentTarget: EventTarget & HTMLDivElement }) {
        const page = document.scrollingElement;
        if (!page) return;
        const pageTop = page.scrollTop, pageMoved = previousPageTop !== undefined && previousPageTop !== pageTop;
        previousPageTop = pageTop;
        const mode = event.deltaMode, delta = event.deltaY;
        if (pageMoved || pendingPageDelta * delta < 0) {
            cancelAnimationFrame(pageScrollFrame);
            pageScrollFrame = 0; pendingPageDelta = 0;
        }
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
            || !delta || Math.abs(event.deltaX) >= Math.abs(delta)) return;
        const column = event.currentTarget;
        if (getComputedStyle(column).overflowY !== "auto") return;
        const canScroll = (element: Element, tolerance = 1) => delta < 0 ? element.scrollTop > tolerance
            : element.scrollTop + element.clientHeight < element.scrollHeight - tolerance;
        if (canScroll(column)) return;
        // Let nested editors and other scrollable content consume the wheel first.
        for (let element = event.target instanceof Element ? event.target : null; element && element !== column; element = element.parentElement) {
            if (/^(auto|scroll)$/.test(getComputedStyle(element).overflowY) && canScroll(element)) return;
        }
        if (!canScroll(page, 0)) return;
        // A continuous wheel gesture can remain latched to a column after it reaches its edge.
        const unit = mode === WheelEvent.DOM_DELTA_LINE ? parseFloat(getComputedStyle(column).lineHeight) || 16
            : mode === WheelEvent.DOM_DELTA_PAGE ? column.clientHeight : 1;
        const scrollPage = (distance: number) => {
            window.scrollBy({ top: distance, behavior: "instant" });
            previousPageTop = page.scrollTop;
        };
        if (event.cancelable) {
            event.preventDefault();
            scrollPage(delta * unit);
        } else if (!pageMoved) {
            // Later events in a native gesture may be noncancelable. Only fill in movement the browser did not handle.
            pendingPageDelta += delta * unit;
            if (pageScrollFrame) return;
            pageScrollFrame = requestAnimationFrame(() => {
                pageScrollFrame = 0;
                const distance = pendingPageDelta;
                pendingPageDelta = 0;
                if (page.scrollTop === pageTop) scrollPage(distance);
            });
        }
    }
</script>

<svelte:window onpopstate={() => { locatedHash = window.location.hash; }} />

{#snippet versionControls()}
    <div class="version-bar">
        {#if showVersionSelect}<Select aria-label="文件版本" fitOptions {options} value={router.query.get("version") ?? ""} disabled={refreshing} onchange={event => { void updateQuery({ version: event.currentTarget.value || null }); }} />{/if}
        {#if showVersionSelect && historyPage < pageCount(material.versions)}<Button loading={loadingHistory} onclick={() => { void older(); }}>加载更早版本</Button>{/if}
        <div class="version-actions">
            {#if material.permissions.canUploadVersion}<Button href={`${materialHref(material.id)}/versions/new`}>上传新版本</Button>{/if}
            {#if showDeleteVersion}<Button variant="ghost" disabled={refreshing || !material.permissions.canDeleteVersion}
                title={material.versions.total === 1 ? "最后一个版本不能单独删除；如需移除，请删除整份资料。" : undefined}
                onclick={() => { deleting = selected ?? null; deleteOpen = true; }}>删除此版本</Button>{/if}
        </div>
    </div>
    {#if historyError}<p class="error">{historyError}</p>{/if}
    {#if refreshing && showVersionSelect}<p class="muted">正在加载版本…</p>{/if}
{/snippet}

<PageLayout title={material.title} class={material.isPublic ? "material-detail-split" : ""} style="max-width: 1280px;" breadcrumbs={[{ label: entry.course.name, href: courseQuestionsHref(entry.course) }, { label: "资料详情" }]}>
    {#if material.tags?.length}<div class="tags">{#each material.tags as tag}<Link href={`${courseQuestionsHref(entry.course)}?${new URLSearchParams({ tag })}`}>{tag}</Link>{/each}</div>{/if}
    {#if !material.isPublic}<OwnedContentPanel id={material.id} showFiles={false} />{/if}
    {#if focus.status === "error"}<ContentState status="error" error={focus.error} reload={focus.reload} />{/if}
    <div class="material-layout" class:split={material.isPublic}>
        <div class="main" onwheel={continuePageScroll}>
            <section class="file" aria-label="文件">
                {#if selected}
                    <FileInfo name={material.title} mime={selected.mime} size={selected.size} version={selected.version} updatedAt={selected.createdAt}
                        previewHref={canOpenFile ? selected.previewUrl ?? undefined : undefined}
                        downloadHref={canOpenFile ? selected.downloadUrl : undefined} downloadVariant="primary"
                        children={hasVersionControls ? versionControls : undefined} />
                    {#if canOpenFile}
                        <FilePreview showInfo={false} showOpenButton={false} src={selected.previewUrl ?? ""} name={material.title} mime={selected.mime} size={selected.size} />
                    {:else}
                        <div class="login-preview"><StateBlock kind="login-required" title="登录后预览和下载" description="登录即可查看文件内容。">
                            {#snippet actions()}<Button variant="primary" href={loginHref(router.href)}>去登录</Button>{/snippet}
                        </StateBlock></div>
                    {/if}
                {:else}
                    <StateBlock kind="empty" title="文件版本不可用" description="请联系资料所有者或课程管理者处理。" />
                    {#if hasVersionControls}{@render versionControls()}{/if}
                {/if}
            </section>
        </div>
        {#if material.isPublic}
            <div class="discussion-panel" onwheel={continuePageScroll}>
                <DiscussionBlock content={material} canManage={material.permissions.canManage} editHref={`${materialHref(material.id)}/edit`}
                    showCommentsButton={false} onchange={reload} onremove={removed} />
                <div class="comments-panel" id="material-comments">
                    <CommentsSection targetKind="material" targetId={material.id} canManage={material.permissions.canManage}
                        focusId={activeFocus?.commentId} onchanged={reload} onlocated={repeat => { void locate(repeat); }} />
                </div>
            </div>
        {/if}
    </div>
    <ConfirmDialog bind:open={deleteOpen} title={`删除版本 ${deleting?.version ?? ""}？`} description="此版本的文件将永久删除，引用它的链接也会失效。资料介绍、其他版本和评论会保留。" danger confirmLabel="删除版本" onconfirm={removeVersion} onerror={error => toast.error(userMessage(error))} />
</PageLayout>

<style>
    .material-layout { display: grid; gap: var(--space-6); min-width: 0; }
    .main, .discussion-panel { display: grid; align-content: start; gap: var(--space-6); min-width: 0; }
    .file { display: grid; gap: var(--space-3); min-width: 0; }
    .version-bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
    .version-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-inline-start: auto; }
    .comments-panel { min-width: 0; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface);
        scroll-margin-top: calc(var(--space-8) * 2 + var(--space-4)); }
    /* The shared frame fits below the header; each column owns its scrolling. */
    @media (min-width: 1024px) {
        /* Match the bottom inset so reaching the page end does not push the frame under the header. */
        :global(.page-layout.material-detail-split) { padding-bottom: var(--space-6); }
        .material-layout.split { --sticky-top: calc(var(--space-8) * 2 + 1px + var(--space-6));
            position: sticky; top: var(--sticky-top); height: calc(100dvh - var(--sticky-top) - var(--space-6));
            grid-template-columns: minmax(0, 1fr) minmax(0, 24rem); grid-template-rows: minmax(0, 1fr); }
        .split > .main, .split > .discussion-panel { min-height: 0; overflow-y: auto; scrollbar-gutter: stable; }
        .split .comments-panel { scroll-margin-top: var(--space-4); }
    }
    @media (max-width: 639px) { .comments-panel { padding: var(--space-3); } }
    .tags { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .tags :global(a) { padding: var(--space-1) var(--space-3); border-radius: var(--radius-md); background: var(--color-accent-soft); font-size: var(--font-size-sm); }
    .muted { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .error { color: var(--color-danger); }
    :global(.comment-item.material-target), :global(.deleted-comment.material-target) { background: var(--color-accent-soft); }
    .login-preview { display: grid; place-items: center; min-height: 24rem; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-sunken); }
</style>