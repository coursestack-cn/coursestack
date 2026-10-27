<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";
    import type { ContentCapabilities, VisibleCommentView, VoteState } from "../../content/types";

    export type Props = Omit<HTMLAttributes<HTMLElement>, "children" | "id"> & {
        item: VisibleCommentView;
        capabilities?: ContentCapabilities;
        voteState?: VoteState;
        highlighted?: boolean;
        replyOpen?: boolean;
        onreply?: () => void;
        onclose?: () => void;
        onvote?: (value: -1 | 0 | 1) => Promise<void>;
        onrequirelogin?: () => void;
        onedit?: () => void;
        editHref?: string;
        ondelete?: () => Promise<void>;
        onreport?: (reason: string) => Promise<void>;
        onmoderate?: (reason: string) => Promise<void>;
        composer?: Snippet<[VisibleCommentView, () => void]>;
    };
</script>

<script lang="ts">
    import { MessageSquare } from "@lucide/svelte";
    import Button from "../ui/Button.svelte";
    import Link from "../ui/Link.svelte";
    import RichText from "../../rich-text/RichText.svelte";
    import { normalizeHref } from "../../rich-text/index";
    import { displayName } from "../../content/display-name";
    import AuthorSignature from "./AuthorSignature.svelte";
    import VoteControl from "./VoteControl.svelte";
    import ContentActions from "./ContentActions.svelte";

    let { item, capabilities = {}, voteState = "readonly", highlighted = false, replyOpen = false,
        onreply, onclose, onvote, onrequirelogin, onedit, editHref, ondelete, onreport, onmoderate,
        composer, class: className = "", ...rest }: Props = $props();
    const anchor = $derived(`comment-${item.id}`);
    const replyLabel = $derived.by(() => {
        const target = item.replyTo;
        if (!target) return null;
        if (target.contentDeleted) return "回复一条已删除的评论";
        if (target.authorDeleted) return "回复已删除的用户";
        if (!target.nickname?.trim()) return "回复未设置昵称的用户";
        return `回复 ${displayName({ nickname: target.nickname, isDeleted: target.authorDeleted })}`;
    });
    const replyHref = $derived.by(() => {
        const href = item.replyTo?.href;
        if (!href) return null;
        // Fragment and query links are supplied by the page, outside the persisted-body URL contract.
        if ((href.startsWith("#") || href.startsWith("?")) && !/[\u0000-\u0020\u007f\\]/u.test(href)) return href;
        return normalizeHref(href);
    });
</script>

<article {...rest} id={anchor} class={`comment-item ${className}`} class:highlighted>
    <header><AuthorSignature author={item.author} size="sm" createdAt={item.createdAt} editedAt={item.editedAt} /></header>
    {#if replyLabel}<p class="reply-target">{#if replyHref}<Link href={replyHref}>{replyLabel}</Link>{:else}{replyLabel}{/if}</p>{/if}
    <RichText doc={item.body} />
    <footer>
        <VoteControl score={item.score} myVote={item.myVote} state={voteState} {onvote} {onrequirelogin} />
        {#if capabilities.canReply && onreply}
            <Button variant="ghost" size="sm" onclick={onreply} aria-label={`回复 ${displayName(item.author)}`}
                aria-expanded={replyOpen} aria-controls={`${anchor}-composer`}>
                {#snippet icon()}<MessageSquare size="1em" />{/snippet}回复
            </Button>
        {/if}
        <div class="actions"><ContentActions kind="comment" canEdit={capabilities.canEdit} canDelete={capabilities.canDelete}
            canReport={capabilities.canReport} canModerate={capabilities.canModerate}
            {onedit} {editHref} {ondelete} {onreport} {onmoderate} /></div>
    </footer>
    {#if replyOpen && composer}
        <div class="composer" id={`${anchor}-composer`}>
            <div class="composer-heading"><span>回复 {displayName(item.author)}</span><Button variant="ghost" size="sm" onclick={onclose}>收起回复</Button></div>
            {@render composer(item, () => onclose?.())}
        </div>
    {/if}
</article>

<style>
    .comment-item { display: grid; gap: var(--space-3); min-width: 0; padding-block: var(--space-4); border-bottom: 1px solid var(--color-border); scroll-margin-block-start: var(--space-8); transition: background var(--duration-base) var(--ease-out); }
    .comment-item.highlighted { background: var(--color-accent-soft); }
    header, footer { display: flex; align-items: center; flex-wrap: wrap; min-width: 0; gap: var(--space-2); }
    .reply-target { font-size: var(--font-size-sm); color: var(--color-text-secondary); overflow-wrap: anywhere; }
    .actions { margin-inline-start: auto; }
    .composer { display: grid; min-width: 0; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    .composer-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .composer-heading span { min-width: 0; overflow-wrap: anywhere; }
    @media (prefers-reduced-motion: reduce) { .comment-item { transition: none; } }
</style>