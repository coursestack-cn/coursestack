<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    import type { VoteState } from "../../content/types";

    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        score: number;
        myVote: -1 | 0 | 1;
        state: VoteState;
        onvote?: (value: -1 | 0 | 1) => Promise<void>;
        onrequirelogin?: () => void;
    };
</script>

<script lang="ts">
    import { onDestroy } from "svelte";
    import { ThumbsUp, ThumbsDown } from "@lucide/svelte";
    import Button from "../ui/Button.svelte";
    import { toast } from "../ui/toast.svelte.js";
    import { isAborted, userMessage } from "../../api/errors";

    const generatedId = $props.id();
    let { score, myVote, state: voteState, onvote, onrequirelogin, class: className = "", ...rest }: Props = $props();
    let optimistic = $state<{ score: number; vote: -1 | 0 | 1 } | null>(null);
    let pending = $state(false);
    let ticket = 0;
    let sourceRevision = 0;
    let disposed = false;
    let previous: { score: number; vote: -1 | 0 | 1; state: VoteState } | undefined;
    const shownScore = $derived(optimistic?.score ?? score);
    const shownVote = $derived(optimistic?.vote ?? myVote);
    const disabled = $derived(pending || voteState === "self" || voteState === "readonly"
        || (voteState === "enabled" && !onvote) || (voteState === "anonymous" && !onrequirelogin));

    $effect(() => {
        const source = { score, vote: myVote, state: voteState };
        if (previous && (source.score !== previous.score || source.vote !== previous.vote || source.state !== previous.state)) {
            sourceRevision++;
            optimistic = null;
            if (source.state !== previous.state) { ticket++; pending = false; }
        }
        previous = source;
    });
    onDestroy(() => { disposed = true; ticket++; });

    async function vote(direction: -1 | 1) {
        if (disabled || pending) return;
        if (voteState === "anonymous") { onrequirelogin?.(); return; }
        if (voteState !== "enabled" || !onvote) return;
        const value = shownVote === direction ? 0 : direction;
        const request = ++ticket;
        const revision = sourceRevision;
        const baseline = { score: shownScore, vote: shownVote };
        optimistic = { score: shownScore - shownVote + value, vote: value };
        pending = true;
        try {
            await onvote(value);
        } catch (error) {
            if (disposed || request !== ticket) return;
            optimistic = revision === sourceRevision ? baseline : null;
            if (!isAborted(error)) toast.error(userMessage(error, { default: "投票失败，稍后重试。" }));
        } finally {
            if (!disposed && request === ticket) pending = false;
        }
    }
</script>

<div {...rest} class={`vote-control ${className}`} aria-busy={pending || undefined}>
    <div class="votes" role="group" aria-label="赞踩" aria-describedby={voteState === "self" ? `${generatedId}-self` : undefined}>
        <Button iconOnly variant="ghost" size="sm" aria-label={shownVote === 1 ? "撤销赞" : "赞"}
            aria-pressed={shownVote === 1} {disabled} title={voteState === "anonymous" ? "登录后点赞" : "赞"}
            onclick={() => { void vote(1); }}><ThumbsUp size="1em" aria-hidden="true" /></Button>
        <span class="score" role="status" aria-live="polite" aria-atomic="true"><span class="sr-only">净赞数 </span>{shownScore}</span>
        <Button iconOnly variant="ghost" size="sm" aria-label={shownVote === -1 ? "撤销踩" : "踩"}
            aria-pressed={shownVote === -1} {disabled} title={voteState === "anonymous" ? "登录后点踩" : "踩"}
            onclick={() => { void vote(-1); }}><ThumbsDown size="1em" aria-hidden="true" /></Button>
    </div>
    {#if voteState === "self"}<span class="explanation" id={`${generatedId}-self`}>不能给自己的内容投票</span>{/if}
</div>

<style>
    .vote-control { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
    .votes { display: inline-flex; align-items: center; gap: var(--space-1); }
    .votes :global([aria-pressed="true"]) { color: var(--color-accent); background: var(--color-accent-soft); }
    .score { min-width: var(--space-5); font-size: var(--font-size-sm); font-weight: var(--font-weight-bold); text-align: center; font-variant-numeric: tabular-nums; }
    .explanation { font-size: var(--font-size-xs); color: var(--color-text-secondary); overflow-wrap: anywhere; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>