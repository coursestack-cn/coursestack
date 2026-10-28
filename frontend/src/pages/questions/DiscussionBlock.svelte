<script lang="ts">
    import { untrack } from "svelte";
    import { navigate, router } from "$lib/router/router.svelte.js";
    import { loginHref } from "$lib/router/urls";
    import { session } from "$lib/session.svelte.js";
    import { validateDoc } from "$lib/rich-text/index";
    import ContentBlock from "$lib/components/content/ContentBlock.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import BodyComposer from "./BodyComposer.svelte";
    import CommentsSection from "./CommentsSection.svelte";
    import { blockView, capabilities, contentActions, encode, questionHref, voteState, type Content } from "./data";

    let { content, canManage, otherAccepted = false, focusComment, onaccept, onunaccept, onchange, onremove, onlocated }: {
        content: Content; canManage: boolean; otherAccepted?: boolean; focusComment?: string;
        onaccept?: () => Promise<void>; onunaccept?: () => Promise<void>; onchange: () => void;
        onremove: (id: string) => void; onlocated?: () => void;
    } = $props();
    let commentsOpen = $state(false), commentsMounted = $state(false), editing = $state(false);
    let currentVote = $state<{ score: number; myVote: -1 | 0 | 1 }>();
    const actions = contentActions(() => session.user?.id);
    const shown = $derived(blockView({ ...content, ...(currentVote ?? {}) }));
    $effect(() => { content.score; content.myVote; currentVote = undefined; });
    $effect(() => { if (focusComment) { commentsOpen = true; commentsMounted = true; } });
    $effect(() => { if (commentsOpen) commentsMounted = true; });
    function login() { void navigate(loginHref(router.href)); }
    function edit() {
        if (content.body !== null && !validateDoc(content.body).ok) { toast.error("这篇正文包含暂不支持的格式，无法编辑。"); return; }
        editing = true;
    }
    async function remove() { await actions.remove(content.id); onremove(content.id); }
    async function hide(reason: string) { await actions.hide(content.id, reason); onremove(content.id); }
</script>

<div class="discussion-block">
    <ContentBlock content={shown} capabilities={capabilities(content.author.id, session.user?.id, canManage)}
        voteState={voteState(content.author.id, session.user?.id, session.status)} {otherAccepted}
        bind:commentsExpanded={commentsOpen} onvote={async value => { currentVote = await actions.vote(content.id, value); }} onrequirelogin={login}
        {onaccept} {onunaccept} editHref={content.kind === "question" ? `${questionHref(content.id)}/edit` : undefined}
        onedit={edit} ondelete={remove} onmoderate={hide} onreport={reason => actions.report(content.id, reason)} />
    {#if editing}
        <div class="editing"><BodyComposer label="编辑回答" guardSamePage path={`/api/contents/${encode(content.id)}`} initial={untrack(() => content.body)}
            oncancel={() => { editing = false; }} oncomplete={() => { editing = false; onchange(); }} /></div>
    {/if}
    {#if commentsMounted}
        <div class="comment-panel" hidden={!commentsOpen}>
            <CommentsSection targetKind={content.kind === "question" ? "question" : "answer"} targetId={content.id} {canManage}
                focusId={focusComment} onchanged={onchange} {onlocated} />
        </div>
    {/if}
</div>

<style>
    .discussion-block { display: grid; gap: var(--space-3); min-width: 0; }
    .editing, .comment-panel { min-width: 0; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .comment-panel[hidden] { display: none; }
    @media (max-width: 639px) { .editing, .comment-panel { padding: var(--space-3); } }
</style>