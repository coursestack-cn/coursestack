<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";
    import type { CommentView, ContentCapabilities, VisibleCommentView, VoteState } from "../../content/types";

    export type CommentCapabilities = ContentCapabilities & { voteState?: VoteState };
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        items: CommentView[];
        highlightId?: string | null;
        capabilityFor?: (comment: VisibleCommentView) => CommentCapabilities;
        onvote?: (id: string, value: -1 | 0 | 1) => Promise<void>;
        onrequirelogin?: () => void;
        onedit?: (id: string) => void;
        editHrefFor?: (comment: VisibleCommentView) => string | undefined;
        ondelete?: (id: string) => Promise<void>;
        onreport?: (id: string, reason: string) => Promise<void>;
        onmoderate?: (id: string, reason: string) => Promise<void>;
        composer?: Snippet<[VisibleCommentView, () => void]>;
    };
</script>

<script lang="ts">
    import CommentItem from "./CommentItem.svelte";
    import DeletedPlaceholder from "./DeletedPlaceholder.svelte";

    let { items, highlightId, capabilityFor, onvote, onrequirelogin, onedit, editHrefFor,
        ondelete, onreport, onmoderate, composer, class: className = "", ...rest }: Props = $props();
    let activeReply = $state<string | null>(null);
    let highlighted = $state<string | null>(null);
    const highlightedItem = $derived(items.find((item) => `comment-${item.id}` === highlighted)?.id ?? highlighted);

    $effect(() => {
        highlighted = highlightId ?? null;
        if (!highlightId) return;
        const timer = setTimeout(() => { highlighted = null; }, 2500);
        return () => clearTimeout(timer);
    });
    $effect(() => {
        if (!activeReply) return;
        const current = items.find((item): item is VisibleCommentView => item.kind === "visible" && item.id === activeReply);
        if (!current || !composer || !capabilityFor?.(current).canReply) activeReply = null;
    });

    function reply(item: VisibleCommentView) {
        if (!composer || !capabilityFor?.(item).canReply) return;
        activeReply = activeReply === item.id ? null : item.id;
    }
</script>

<div {...rest} class={`comment-list ${className}`} role="list" aria-label={rest["aria-label"] ?? "评论"}>
    {#each items as item (item.id)}
        {#if item.kind === "deleted"}
            <DeletedPlaceholder commentId={item.id} role="listitem" class={highlightedItem === item.id ? "comment-list-highlight" : ""} />
        {:else}
            {@const capabilities = capabilityFor?.(item) ?? {}}
            <CommentItem {item} role="listitem" {capabilities} voteState={capabilities.voteState ?? "readonly"}
                highlighted={highlightedItem === item.id} replyOpen={activeReply === item.id}
                onreply={composer ? () => reply(item) : undefined} onclose={() => { activeReply = null; }} {composer}
                onvote={onvote ? (value) => onvote(item.id, value) : undefined} {onrequirelogin}
                onedit={onedit ? () => onedit(item.id) : undefined} editHref={editHrefFor?.(item)}
                ondelete={ondelete ? () => ondelete(item.id) : undefined}
                onreport={onreport ? (reason) => onreport(item.id, reason) : undefined}
                onmoderate={onmoderate ? (reason) => onmoderate(item.id, reason) : undefined} />
        {/if}
    {/each}
</div>

<style>
    .comment-list { min-width: 0; }
    .comment-list :global(.comment-list-highlight) { background: var(--color-accent-soft); }
</style>