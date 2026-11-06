<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";
    import type { RichTextDoc } from "../../rich-text/index";
    import type { AuthorView, ContentCapabilities, VoteState } from "../../content/types";

    export type ContentBlockView = {
        id: string;
        kind: "question" | "answer" | "material";
        author: AuthorView;
        body: RichTextDoc;
        createdAt: number;
        editedAt?: number | null;
        score: number;
        myVote: -1 | 0 | 1;
        accepted?: boolean;
        solved?: boolean;
        commentCount?: number;
    };
    export type Props = Omit<HTMLAttributes<HTMLElement>, "children" | "id"> & {
        content: ContentBlockView;
        capabilities?: ContentCapabilities;
        voteState?: VoteState;
        otherAccepted?: boolean;
        commentsExpanded?: boolean;
        showCommentsButton?: boolean;
        /** Link to a comment area rendered elsewhere on the page instead of toggling inline comments. */
        commentsHref?: string;
        comments?: Snippet;
        oncomments?: () => void;
        onvote: (value: -1 | 0 | 1) => Promise<void>;
        onrequirelogin?: () => void;
        onaccept?: () => Promise<void>;
        onunaccept?: () => Promise<void>;
        onedit?: () => void;
        editHref?: string;
        ondelete?: () => Promise<void>;
        onreport?: (reason: string) => Promise<void>;
        onmoderate?: (reason: string) => Promise<void>;
    };
</script>

<script lang="ts">
    import { MessageCircle } from "@lucide/svelte";
    import Button from "../ui/Button.svelte";
    import RichText from "../../rich-text/RichText.svelte";
    import { isEmptyDoc } from "../../rich-text/index";
    import AuthorSignature from "./AuthorSignature.svelte";
    import ContentBadge from "./ContentBadge.svelte";
    import VoteControl from "./VoteControl.svelte";
    import AcceptControl from "./AcceptControl.svelte";
    import ContentActions from "./ContentActions.svelte";

    let { content, capabilities = {}, voteState = "readonly", otherAccepted = false,
        commentsExpanded = $bindable(false), showCommentsButton = true, commentsHref, comments, oncomments, onvote, onrequirelogin,
        onaccept, onunaccept, onedit, editHref, ondelete, onreport, onmoderate,
        class: className = "", ...rest }: Props = $props();
</script>

<article {...rest} id={`${content.kind}-${content.id}`} class={`content-block ${className}`} class:accepted={content.kind === "answer" && content.accepted}>
    <header>
        <AuthorSignature author={content.author} createdAt={content.createdAt} editedAt={content.editedAt} linkTeacher />
        {#if content.kind === "answer" && content.accepted}<ContentBadge kind="accepted" />
        {:else if content.kind === "question"}<ContentBadge kind={content.solved ? "solved" : "unsolved"} />{/if}
    </header>
    {#if content.kind === "material" && isEmptyDoc(content.body)}<p class="empty-body">暂无资料介绍</p>
    {:else}<RichText doc={content.body} />{/if}
    <footer>
        <VoteControl score={content.score} myVote={content.myVote} state={voteState} {onvote} {onrequirelogin} />
        {#if content.kind === "answer" && capabilities.canAccept && onaccept && onunaccept}
            <AcceptControl accepted={content.accepted ?? false} {otherAccepted} {onaccept} {onunaccept} />
        {/if}
        {#if showCommentsButton && commentsHref}
            <Button size="sm" variant="ghost" href={commentsHref}>
                {#snippet icon()}<MessageCircle size="1em" />{/snippet}
                评论{content.commentCount === undefined ? "" : `（${content.commentCount}）`}
            </Button>
        {:else if showCommentsButton}
            <Button size="sm" variant="ghost" aria-expanded={commentsExpanded} aria-controls={comments ? `${content.kind}-${content.id}-comments` : undefined}
                onclick={() => { commentsExpanded = !commentsExpanded; oncomments?.(); }}>
                {#snippet icon()}<MessageCircle size="1em" />{/snippet}
                评论{content.commentCount === undefined ? "" : `（${content.commentCount}）`}
            </Button>
        {/if}
        <div class="more"><ContentActions kind={content.kind} canEdit={capabilities.canEdit} canDelete={capabilities.canDelete}
            canReport={capabilities.canReport} canModerate={capabilities.canModerate}
            {onedit} {editHref} {ondelete} {onreport} {onmoderate} /></div>
    </footer>
    {#if commentsExpanded && comments}<div class="comments" id={`${content.kind}-${content.id}-comments`}>{@render comments()}</div>{/if}
</article>

<style>
    .content-block { display: grid; gap: var(--space-5); min-width: 0; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); scroll-margin-top: var(--space-6); }
    .accepted { border-color: var(--color-success); border-inline-start-width: var(--space-1); }
    header, footer { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
    header { justify-content: space-between; }
    .empty-body { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    footer { border-top: 1px solid var(--color-border); padding-top: var(--space-3); }
    .more { margin-inline-start: auto; }
    .comments { min-width: 0; border-top: 1px solid var(--color-border); padding-top: var(--space-3); }
    @media (max-width: 639px) { .content-block { padding: var(--space-3); } }
</style>