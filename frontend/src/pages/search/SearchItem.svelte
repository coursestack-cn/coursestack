<script lang="ts">
    import Link from "$lib/components/ui/Link.svelte";
    import Tag from "$lib/components/ui/Tag.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import { displayName } from "$lib/content/display-name";
    import { encode, questionHref, urlId } from "../questions/data";
    import { materialHref } from "../materials/data";
    import HighlightedText from "./HighlightedText.svelte";
    import type { SearchItem } from "./data";
    let { item }: { item: SearchItem } = $props();
    const labels = { course: "课程", material: "资料", question: "问题", answer: "回答" };
    const href = $derived(item.kind === "course" ? `/courses/${encode(item.id)}` : item.kind === "material" ? materialHref(item.id)
        : item.kind === "question" ? questionHref(item.id) : `/answers/${encode(urlId(item.id))}`);
</script>

<article>
    <Link {href} class="search-result">
        <p class="context"><span>{labels[item.kind]}</span><span>{item.course.name}</span><span class="code">{item.course.id}</span></p>
        <h2><HighlightedText text={item.title} ranges={item.highlights.title} /></h2>
        {#if item.excerpt}<p class="excerpt"><HighlightedText text={item.excerpt} ranges={item.highlights.excerpt} /></p>{/if}
        {#if item.tags.length}<ul class="tags">{#each item.tags as tag}<li><Tag>{tag}</Tag></li>{/each}</ul>{/if}
        <footer>
            {#if item.author}<span>{displayName(item.author)}</span>{#if item.author.isTeacher}<span>教师</span>{/if}{/if}
            <span>更新于 <RelativeTime timestamp={item.updatedAt} /></span>
        </footer>
    </Link>
</article>

<style>
    article { min-width: 0; border-bottom: 1px solid var(--color-border); }
    article:last-child { border-bottom: 0; }
    article :global(.search-result) { display: grid; gap: var(--space-3); padding: var(--space-5); color: var(--color-text); text-decoration: none; }
    article :global(.search-result:hover) { background: var(--color-surface-sunken); text-decoration: none; }
    article :global(.search-result:focus-visible) { outline-offset: -2px; }
    h2 { color: var(--color-accent); font-size: var(--font-size-lg); overflow-wrap: anywhere; }
    .context, footer { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .context { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .excerpt { overflow-wrap: anywhere; }
    footer, .tags { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .tags { list-style: none; padding: 0; gap: var(--space-2); }
    .tags li { min-width: 0; max-width: 100%; }
    @media (max-width: 639px) { article :global(.search-result) { padding: var(--space-3); } }
</style>