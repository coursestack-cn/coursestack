<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { api, ApiError } from "$lib/api/client";
    import { userMessage } from "$lib/api/errors";
    import { resource } from "$lib/api/resource.svelte";
    import { session } from "$lib/session.svelte";
    import { navigate, router, setTitle, updateQuery } from "$lib/router/router.svelte";
    import { loginHref } from "$lib/router/urls";
    import { isEmptyDoc } from "$lib/rich-text/index";
    import RichText from "$lib/rich-text/RichText.svelte";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import AuthorSignature from "$lib/components/content/AuthorSignature.svelte";
    import ContentActions from "$lib/components/content/ContentActions.svelte";
    import VoteControl from "$lib/components/content/VoteControl.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import FilePreview from "$lib/components/files/FilePreview.svelte";
    import FileInfo from "$lib/components/files/FileInfo.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import CommentsSection from "../questions/CommentsSection.svelte";
    import ContentState from "../questions/ContentState.svelte";
    import { capabilities, contentActions, courseQuestionsHref, locateContent, pageCount, voteState, type CourseEntry, type Page } from "../questions/data";
    import { materialHref, materialPath, type Material, type MaterialVersion } from "./data";

    let { material, entry, refreshing, reload }: { material: Material; entry: CourseEntry; refreshing: boolean; reload: () => void } = $props();
    let previous = $state<MaterialVersion[]>([]), historyPage = $state(1), loadingHistory = $state(false), historyError = $state("");
    let deleting = $state<MaterialVersion | null>(null), deleteOpen = $state(false);
    let vote = $state<{ score: number; myVote: -1 | 0 | 1 }>();
    const controller = new AbortController();
    onDestroy(() => controller.abort());
    const mutations = contentActions(() => session.user?.id);
    const selected = $derived(material.selectedVersion);
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
    $effect(() => { setTitle(material.title); });
    $effect(() => { material.score; material.myVote; vote = undefined; });
    async function locate() {
        await tick();
        if (activeFocus) document.getElementById(decodeURIComponent(activeFocus.hash.slice(1)))?.scrollIntoView({ block: "start", behavior: "instant" });
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
    async function removeMaterial(reason?: string) {
        if (reason === undefined) await mutations.remove(material.id); else await mutations.hide(material.id, reason);
        toast.success(reason === undefined ? "已删除资料" : "已下架资料");
        void navigate(courseQuestionsHref(entry.course), { replace: true });
    }
</script>

<PageLayout title={material.title} breadcrumbs={[{ label: entry.course.name, href: courseQuestionsHref(entry.course) }, { label: "资料详情" }]}>
    {#snippet actions()}
        {#if material.permissions.canUploadVersion}<Button href={`${materialHref(material.id)}/versions/new`}>上传新版本</Button>{/if}
        <ContentActions kind="material" {...capabilities(material.author.id, session.user?.id, material.permissions.canManage)}
            editHref={`${materialHref(material.id)}/edit`} ondelete={() => removeMaterial()} onmoderate={removeMaterial} onreport={reason => mutations.report(material.id, reason)} />
    {/snippet}
    <section class="introduction">
        <div class="metadata"><AuthorSignature author={material.author} createdAt={material.createdAt} editedAt={material.editedAt} />
            <VoteControl score={vote?.score ?? material.score} myVote={vote?.myVote ?? material.myVote} state={voteState(material.author.id, session.user?.id, session.status)}
                onvote={async value => { vote = await mutations.vote(material.id, value); }} onrequirelogin={() => { void navigate(loginHref(router.href)); }} />
        </div>
        {#if material.tags?.length}<div class="tags">{#each material.tags as tag}<Link href={`${courseQuestionsHref(entry.course)}?${new URLSearchParams({ tag })}`}>{tag}</Link>{/each}</div>{/if}
        {#if material.body && !isEmptyDoc(material.body)}<RichText doc={material.body} />{:else}<p class="muted">暂无资料介绍</p>{/if}
    </section>
    <section class="preview">
        <div class="version-bar">
            <h2>文件预览</h2>
            {#if selected}<Field label="文件版本">{#snippet children({ id })}<Select {id} {options} value={router.query.get("version") ?? ""} disabled={refreshing} onchange={event => { void updateQuery({ version: event.currentTarget.value || null }); }} />{/snippet}</Field>{/if}
            {#if historyPage < pageCount(material.versions)}<Button loading={loadingHistory} onclick={() => { void older(); }}>加载更早版本</Button>{/if}
            {#if selected && material.permissions.canDeleteVersion}<Button variant="ghost" disabled={refreshing} onclick={() => { deleting = selected; deleteOpen = true; }}>删除此版本</Button>{/if}
        </div>
        {#if historyError}<p class="error">{historyError}</p>{/if}
        {#if refreshing}<p class="muted">正在加载版本…</p>{/if}
        {#if selected}
            <p class="muted">版本 {selected.version}，上传于 <RelativeTime timestamp={selected.createdAt} /></p>
            {#if session.user && !material.permissions.requiresLoginForFile}
                <FilePreview src={selected.previewUrl ?? ""} name={material.title} mime={selected.mime} size={selected.size} downloadHref={selected.downloadUrl} />
            {:else}
                <FileInfo name={material.title} mime={selected.mime} size={selected.size} />
                <div class="login-preview"><StateBlock kind="login-required" title="登录后预览和下载" description="登录即可查看文件内容。">
                    {#snippet actions()}<Button variant="primary" href={loginHref(router.href)}>去登录</Button>{/snippet}
                </StateBlock></div>
            {/if}
        {:else}<StateBlock kind="empty" title="暂无文件版本" description="所有文件版本已被删除，资料介绍与评论仍保留。" />{/if}
    </section>
    {#if focus.status === "error"}<ContentState status="error" error={focus.error} reload={focus.reload} />{/if}
    <div class="comments"><CommentsSection targetKind="material" targetId={material.id} canManage={material.permissions.canManage} focusId={activeFocus?.commentId} onlocated={() => { void locate(); }} /></div>
    <ConfirmDialog bind:open={deleteOpen} title={`删除版本 ${deleting?.version ?? ""}？`} description="此版本的文件将永久删除，引用它的链接也会失效。资料介绍、其他版本和评论会保留。" danger confirmLabel="删除版本" onconfirm={removeVersion} onerror={error => toast.error(userMessage(error))} />
</PageLayout>

<style>
    .introduction, .preview { display: grid; min-width: 0; gap: var(--space-4); }
    .introduction { padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .metadata, .version-bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
    .metadata { justify-content: space-between; }
    .version-bar > :global(.field) { min-width: 12rem; }
    h2 { font-size: var(--font-size-xl); margin-inline-end: auto; }
    .tags { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .tags :global(a) { padding: var(--space-1) var(--space-3); border-radius: var(--radius-md); background: var(--color-accent-soft); font-size: var(--font-size-sm); }
    .muted { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .error { color: var(--color-danger); }
    .login-preview { display: grid; place-items: center; min-height: 24rem; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-sunken); }
    .comments { border-top: 1px solid var(--color-border); padding-top: var(--space-6); }
    @media (max-width: 639px) { .introduction { padding: var(--space-3); } }
</style>