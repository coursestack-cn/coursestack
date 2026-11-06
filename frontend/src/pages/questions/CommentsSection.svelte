<script lang="ts">
    import { tick, untrack } from "svelte";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import { navigate, router, shouldInterceptLink } from "$lib/router/router.svelte.js";
    import { loginHref } from "$lib/router/urls";
    import { displayName } from "$lib/content/display-name";
    import { validateDoc } from "$lib/rich-text/index";
    import CommentItem from "$lib/components/content/CommentItem.svelte";
    import DeletedPlaceholder from "$lib/components/content/DeletedPlaceholder.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import ContentState from "./ContentState.svelte";
    import BodyComposer from "./BodyComposer.svelte";
    import { capabilities, commentView, contentActions, encode, findItemPage, pageCount, urlId, voteState, type Comment, type Content, type Page } from "./data";

    let { targetId, targetKind, canManage, focusId, onchanged, onlocated }: {
        targetId: string; targetKind: "question" | "answer" | "material"; canManage: boolean;
        focusId?: string; onchanged?: () => void; onlocated?: (repeat: boolean) => void;
    } = $props();
    let page = $state(1), sort = $state("oldest");
    let seeking = $state<string | undefined>();
    let replyLocation = $state<string | undefined>();
    let votes = $state<Record<string, { score: number; myVote: -1 | 0 | 1 }>>({});
    let composer = $state<{ kind: "reply" | "edit"; item: Content } | null>(null);
    let composerState = $state({ dirty: false, pending: false });
    let switchOpen = $state(false);
    let switchTo: (() => void) | undefined;
    let section: HTMLElement;
    let composerHome = $state<HTMLDivElement>();
    let composerElement = $state<HTMLDivElement>();
    const actions = contentActions(() => session.user?.id);
    $effect(() => {
        const wanted = focusId;
        seeking = untrack(() => wanted && !comments.data?.items.some(item => item.id === wanted) ? wanted : undefined);
    });
    const comments = resource(async signal => {
        const query = new URLSearchParams({ targetKind, targetId, sort });
        const current = page, wanted = seeking;
        session.user?.id;
        const path = `/api/comments?${query}`;
        const result = await api.get<Page<Comment>>(`${path}&page=${current}&pageSize=20`, { signal });
        if (wanted && !result.items.some(item => item.id === wanted)) return await findItemPage<Comment>(path, wanted, signal) ?? result;
        return result;
    });
    $effect(() => {
        const data = comments.data;
        if (!data || comments.refreshing) return;
        if (seeking) { page = data.page; seeking = undefined; }
        if (page > pageCount(data)) page = pageCount(data);
        if (focusId && data.items.some(item => item.id === focusId)) {
            const repeat = replyLocation === focusId;
            if (repeat) replyLocation = undefined;
            void tick().then(() => onlocated?.(repeat));
        }
    });
    async function followReply(event: MouseEvent, id: string | undefined) {
        const anchor = event.currentTarget;
        if (!id || !(anchor instanceof HTMLAnchorElement) || !shouldInterceptLink(event, anchor)) return;
        event.preventDefault();
        if (!await navigate(anchor.href)) return;
        replyLocation = id;
        if (!comments.data?.items.some(item => item.id === id)) seeking = id;
    }
    function placeComposer(element: HTMLDivElement) {
        // Keep the editor mounted when its comment moves or leaves the current page.
        $effect(() => {
            const replyId = composer?.kind === "reply" ? urlId(composer.item.id) : undefined;
            comments.data;
            const destination = replyId ? section.querySelector<HTMLElement>(`[data-reply-composer="${replyId}"]`) : null;
            const parent = destination ?? composerHome;
            if (parent && element.parentElement !== parent) parent.append(element);
        });
        return { destroy() { element.remove(); } };
    }
    function choose(next: typeof composer) {
        if (composerState.pending) return;
        if (composer?.kind === next?.kind && composer?.item.id === next?.item.id) return;
        const change = () => {
            composer = next;
            composerState = { dirty: false, pending: false };
            if (!next) return;
            void tick().then(() => {
                composerElement?.scrollIntoView({ block: "nearest" });
                composerElement?.querySelector<HTMLElement>('[role="textbox"]')?.focus({ preventScroll: true });
            });
        };
        if (composerState.dirty) { switchTo = change; switchOpen = true; }
        else change();
    }
    function reply(item: Content) {
        choose(composer?.kind === "reply" && composer.item.id === item.id ? null : { kind: "reply", item });
    }
    function edit(item: Content) {
        if (item.body !== null && !validateDoc(item.body).ok) { toast.error("这篇正文包含暂不支持的格式，无法编辑。"); return; }
        choose({ kind: "edit", item });
    }
    function changed() { comments.reload(); onchanged?.(); }
    function completed(id?: string) {
        composer = null;
        composerState = { dirty: false, pending: false };
        if (id) seeking = id;
        changed();
    }
    async function remove(id: string) { await actions.remove(id); changed(); }
    async function hide(id: string, reason: string) { await actions.hide(id, reason); changed(); }
    function login() { void navigate(loginHref(router.href)); }
</script>

<section bind:this={section} class="comments-section" aria-label="评论区">
    <div class="comments-heading"><h3>评论</h3><Select aria-label="评论排序" options={[{ value: "oldest", label: "时间顺序" }, { value: "score", label: "净赞数" }]} value={sort}
        onchange={event => { sort = event.currentTarget.value; page = 1; seeking = undefined; }} /></div>
    <ContentState status={comments.status} error={comments.error} refreshing={comments.refreshing} reload={comments.reload}>
        {#if comments.data}
            {#if comments.data.items.length}
                <div role="list" aria-label="评论列表">
                    {#each comments.data.items as item (item.id)}
                        {@const view = commentView(item.status === "deleted" ? item : { ...item, ...(votes[item.id] ?? {}) })}
                        {#if view.kind === "deleted"}<DeletedPlaceholder commentId={view.id} role="listitem" />
                        {:else if item.status !== "deleted"}
                            <div role="listitem">
                                <CommentItem item={view} capabilities={capabilities(item.author.id, session.user?.id, canManage, item.canDelete)}
                                    voteState={voteState(item.author.id, session.user?.id, session.status)}
                                    onvote={async value => { votes[item.id] = await actions.vote(item.id, value); }} onrequirelogin={login}
                                    onfollowreply={event => { void followReply(event, item.replyTo?.id); }}
                                    replyOpen={composer?.kind === "reply" && composer.item.id === item.id} onreply={() => reply(item)}
                                    onedit={() => edit(item)} ondelete={() => remove(item.id)} onmoderate={reason => hide(item.id, reason)}
                                    onreport={reason => actions.report(item.id, reason)} />
                                <div class="reply-slot" data-reply-composer={urlId(item.id)}></div>
                            </div>
                        {/if}
                    {/each}
                </div>
            {:else}<p class="empty">还没有评论。</p>{/if}
            {#if pageCount(comments.data) > 1}<Pagination page={comments.data.page} pageCount={pageCount(comments.data)} disabled={comments.refreshing}
                onchange={(next: number) => { page = next; seeking = undefined; }} />{/if}
        {/if}
    </ContentState>
    {#if session.user}
        <div class="compose-home" bind:this={composerHome}>
            <div class="compose" bind:this={composerElement} use:placeComposer id={composer ? `comment-${urlId(composer.item.id)}-composer` : undefined}>
                {#key `${composer?.kind ?? "new"}:${composer?.item.id ?? targetId}`}
                    <BodyComposer label={composer?.kind === "reply" ? `回复 ${displayName(composer.item.author)}` : composer?.kind === "edit" ? "编辑评论" : "发表评论"}
                        submitLabel={composer?.kind === "reply" ? "发布回复" : undefined} compact guardSamePage={targetKind === "answer"}
                        path={composer?.kind === "edit" ? `/api/contents/${encode(composer.item.id)}` : "/api/comments"}
                        initial={composer?.kind === "edit" ? composer.item.body : undefined}
                        context={composer?.kind === "reply" ? { targetKind: "comment", targetId: composer.item.id } : { targetKind, targetId }}
                        onstatechange={state => { composerState = state; }} oncomplete={completed}
                        oncancel={composer ? () => { composer = null; composerState = { dirty: false, pending: false }; } : undefined} />
                {/key}
            </div>
        </div>
    {:else if session.status === "anonymous"}<Button href={loginHref(router.href)} variant="ghost">登录后发表评论</Button>
    {:else}<StateBlock kind="loading" title="正在确认登录状态" />{/if}
    <ConfirmDialog bind:open={switchOpen} title="放弃当前修改？" description="尚未提交的评论内容将丢失。" confirmLabel="放弃修改" onconfirm={() => switchTo?.()} />
</section>

<style>
    .comments-section { display: grid; gap: var(--space-4); min-width: 0; }
    .comments-heading { display: grid; grid-template-columns: auto auto; justify-content: start; align-items: center; gap: var(--space-4); }
    h3 { font-size: var(--font-size-lg); }
    .empty { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .compose-home { display: contents; }
    .reply-slot { min-width: 0; }
    .reply-slot:not(:empty) { padding-block: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-border); }
    .compose { display: grid; gap: var(--space-3); min-width: 0; padding-block-start: var(--space-3); }
</style>