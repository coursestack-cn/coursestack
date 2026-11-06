<script lang="ts">
    import { FileText, MessageSquare } from "@lucide/svelte";
    import { toPlainText, validateDoc } from "$lib/rich-text/index";
    import { formatBytes } from "$lib/files/format-bytes";
    import Link from "$lib/components/ui/Link.svelte";
    import Tag from "$lib/components/ui/Tag.svelte";
    import AuthorSignature from "$lib/components/content/AuthorSignature.svelte";
    import ContentBadge from "$lib/components/content/ContentBadge.svelte";
    import { ownedContentHref, questionHref } from "../questions/data";
    import { materialHref, type CourseContent } from "../materials/data";

    let { item }: { item: CourseContent } = $props();
    const material = $derived(item.kind === "material");
    const excerpt = $derived.by(() => { const doc = validateDoc(item.body); return doc.ok ? toPlainText(doc.doc, { maxChars: 180 }) : ""; });
</script>

<article>
    <Link class="course-content-link" href={!item.isPublic ? ownedContentHref(item.id) : material ? materialHref(item.id) : questionHref(item.id)}>
        <div class="heading"><span class="kind">{#if material}<FileText size="1em" />资料{:else}<MessageSquare size="1em" />问题{/if}</span><h3>{item.title}</h3>
            {#if !item.isPublic}<span class="kind">{item.status === "hidden" ? "已下架" : "暂不公开"}</span>{/if}
            {#if !material}<ContentBadge kind={item.solved ? "solved" : "unsolved"} />{/if}
        </div>
        {#if excerpt}<p class="excerpt">{excerpt}</p>{/if}
        {#if item.tags?.length}<ul class="tags">{#each item.tags as tag}<li><Tag>{tag}</Tag></li>{/each}</ul>{/if}
        <footer><AuthorSignature author={item.author} size="sm" createdAt={item.createdAt} editedAt={item.editedAt} />
            <div class="metadata">
                {#if material}{#if item.latestVersion}<span>版本 {item.latestVersion.version}</span><span>{formatBytes(item.latestVersion.size)}</span>{:else}<span>暂无文件版本</span>{/if}{/if}
                <span>净赞数 {item.score}</span><span>{material ? `${item.commentCount} 条评论` : `${item.answerCount ?? 0} 个回答`}</span>
            </div>
        </footer>
    </Link>
</article>

<style>
    article { min-width: 0; border-bottom: 1px solid var(--color-border); }
    :global(.course-content-link) { display: grid; gap: var(--space-3); padding: var(--space-5); min-width: 0; color: var(--color-text); text-decoration: none; }
    :global(.course-content-link:hover) { background: var(--color-surface-sunken); text-decoration: none; }
    :global(.course-content-link:active) { background: var(--color-accent-soft); }
    :global(.course-content-link:focus-visible) { outline-offset: -2px; }
    .heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-3); }
    .kind { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    h3 { flex: 1 1 12rem; min-width: 0; color: var(--color-accent); font-size: var(--font-size-lg); overflow-wrap: anywhere; }
    .excerpt { color: var(--color-text-secondary); white-space: pre-line; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .tags { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .tags li { min-width: 0; max-width: 100%; }
    footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); }
    .metadata { display: flex; flex-wrap: wrap; gap: var(--space-3); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    @media (max-width: 639px) { :global(.course-content-link) { padding: var(--space-3); } }
</style>