<script lang="ts">
    import { toPlainText, validateDoc } from "$lib/rich-text/index";
    import { displayName } from "$lib/content/display-name";
    import { formatBytes } from "$lib/files/format-bytes";
    import Link from "$lib/components/ui/Link.svelte";
    import Tag from "$lib/components/ui/Tag.svelte";
    import ContentBadge from "$lib/components/content/ContentBadge.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import { encode, questionHref, urlId } from "../questions/data";
    import { materialHref } from "../materials/data";
    import type { TeacherContent } from "./data";

    let { item }: { item: TeacherContent } = $props();
    const excerpt = $derived.by(() => { const doc = validateDoc(item.body); return doc.ok ? toPlainText(doc.doc, { maxChars: 240 }) : ""; });
    const href = $derived(item.kind === "material" ? materialHref(item.id) : item.kind === "question" ? questionHref(item.id)
        : `/${item.kind === "answer" ? "answers" : "comments"}/${encode(urlId(item.id))}`);
    const context = $derived.by(() => {
        if (item.kind === "material") return "发布了资料";
        if (item.kind === "question") return "提出了问题";
        if (item.kind === "answer") return "回答了问题";
        if (item.quote) {
            const target = item.quote.author ? displayName(item.quote.author) : null;
            return item.quote.kind === "comment" ? target ? `回复了 ${target} 的评论` : "回复了一条评论"
                : target ? `评论了 ${target} 的回答` : "评论了一条回答";
        }
        return item.root.kind === "material" ? "评论了资料" : "评论了问题";
    });
</script>

<article>
    <Link class="teacher-content-link" {href}>
        <p class="context">{item.courseName} · {context}</p>
        <div class="heading"><h2>{item.root.title}</h2>
            {#if item.kind === "question"}<ContentBadge kind={item.solved ? "solved" : "unsolved"} />
            {:else if item.kind === "answer" && item.isAccepted}<ContentBadge kind="accepted" />{/if}
        </div>
        {#if item.quote}
            <blockquote>{#if item.quote.available}
                {#if item.quote.author}<span>{displayName(item.quote.author)}： </span>{/if}{item.quote.excerpt || "暂无文字摘要"}
            {:else}原{item.quote.kind === "answer" ? "回答" : "评论"}不可用{/if}</blockquote>
        {/if}
        {#if excerpt}<p class="excerpt">{excerpt}</p>{/if}
        {#if item.tags?.length}<ul class="tags">{#each item.tags as tag}<li><Tag>{tag}</Tag></li>{/each}</ul>{/if}
        <footer>
            {#if item.kind === "material" && item.latestVersion}<span>版本 {item.latestVersion.version}</span><span>{formatBytes(item.latestVersion.size)}</span>{/if}
            <span>净赞数 {item.score}</span>
            {#if item.kind === "question"}<span>{item.answerCount ?? 0} 个回答</span>
            {:else if item.kind !== "comment"}<span>{item.commentCount} 条评论</span>{/if}
            <RelativeTime timestamp={item.createdAt} />{#if item.editedAt !== null}<span>已编辑</span>{/if}
        </footer>
    </Link>
</article>

<style>
    article { min-width: 0; border-bottom: 1px solid var(--color-border); }
    article :global(.teacher-content-link) { display: grid; gap: var(--space-3); min-width: 0; padding: var(--space-5); color: var(--color-text); text-decoration: none; }
    article :global(.teacher-content-link:hover) { background: var(--color-surface-sunken); text-decoration: none; }
    article :global(.teacher-content-link:active) { background: var(--color-accent-soft); }
    article :global(.teacher-content-link:focus-visible) { outline-offset: -2px; }
    .context, footer { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .heading, footer { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    h2 { color: var(--color-accent); font-size: var(--font-size-lg); overflow-wrap: anywhere; }
    .excerpt { white-space: pre-line; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    blockquote { margin: 0; padding: var(--space-2) var(--space-3); border-left: 2px solid var(--color-border-strong); background: var(--color-surface-sunken); color: var(--color-text-secondary); font-size: var(--font-size-sm); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .tags { display: flex; flex-wrap: wrap; gap: var(--space-2); list-style: none; padding: 0; }
    .tags li { min-width: 0; max-width: 100%; }
    @media (max-width: 639px) { article :global(.teacher-content-link) { padding: var(--space-3); } }
</style>