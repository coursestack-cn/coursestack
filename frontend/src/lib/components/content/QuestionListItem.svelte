<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    import type { AuthorView } from "../../content/types";

    export type QuestionListView = {
        id: string;
        title: string;
        href: string;
        excerpt: string;
        tags: string[];
        solved: boolean;
        score: number;
        answerCount?: number;
        author: AuthorView;
        createdAt: number;
        editedAt?: number | null;
    };
    export type Props = Omit<HTMLAttributes<HTMLElement>, "children"> & { question: QuestionListView };
</script>

<script lang="ts">
    import { MessageSquare, ThumbsUp } from "@lucide/svelte";
    import Link from "../ui/Link.svelte";
    import Tag from "../ui/Tag.svelte";
    import AuthorSignature from "./AuthorSignature.svelte";
    import ContentBadge from "./ContentBadge.svelte";

    let { question, class: className = "", ...rest }: Props = $props();
</script>

<article {...rest} class={`question-item ${className}`}>
    <Link class="question-item-link" href={question.href} aria-label={question.title}>
        <div class="heading"><h3>{question.title}</h3><ContentBadge kind={question.solved ? "solved" : "unsolved"} /></div>
        {#if question.excerpt}<p class="excerpt">{question.excerpt}</p>{/if}
        {#if question.tags.length}<ul class="tags" aria-label="标签">{#each question.tags as tag}<li><Tag>{tag}</Tag></li>{/each}</ul>{/if}
        <footer>
            <AuthorSignature author={question.author} size="sm" createdAt={question.createdAt} editedAt={question.editedAt} />
            <div class="counts"><span><ThumbsUp size="1em" aria-hidden="true" /><span>净分 {question.score}</span></span>
                {#if question.answerCount !== undefined}<span><MessageSquare size="1em" aria-hidden="true" /><span>{question.answerCount} 个回答</span></span>{/if}
            </div>
        </footer>
    </Link>
</article>

<style>
    .question-item { min-width: 0; border-bottom: 1px solid var(--color-border); }
    :global(.question-item-link) { display: grid; gap: var(--space-3); padding: var(--space-5); min-width: 0; color: var(--color-text); text-decoration: none; transition: background var(--duration-fast) var(--ease-out); }
    :global(.question-item-link:hover) { background: var(--color-surface-sunken); text-decoration: none; }
    :global(.question-item-link:active) { background: var(--color-accent-soft); }
    :global(.question-item-link:focus-visible) { outline-offset: -2px; }
    .heading { display: flex; flex-wrap: wrap; align-items: start; gap: var(--space-3); }
    h3 { flex: 1 1 min(100%, calc(var(--space-12) * 5)); min-width: 0; color: var(--color-accent); font-size: var(--font-size-lg); overflow-wrap: anywhere; }
    .excerpt { color: var(--color-text-secondary); font-size: var(--font-size-md); overflow-wrap: anywhere; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .tags { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .tags li { min-width: 0; max-width: 100%; }
    footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
    .counts, .counts > span { display: flex; align-items: center; gap: var(--space-2); }
    .counts { flex-wrap: wrap; gap: var(--space-4); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    @media (max-width: 639px) { :global(.question-item-link) { padding: var(--space-3); } }
</style>