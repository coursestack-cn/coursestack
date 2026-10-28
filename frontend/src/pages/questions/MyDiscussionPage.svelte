<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import { router, updateQuery } from "$lib/router/router.svelte.js";
    import { toPlainText, validateDoc } from "$lib/rich-text/index";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import QuestionListItem from "$lib/components/content/QuestionListItem.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { encode, pageCount, pageNumber, questionView, urlId, type Page, type Content } from "./data";

    let { kind }: { kind: "question" | "answer" } = $props();
    const title = $derived(kind === "question" ? "我的提问" : "我的回答");
    const page = $derived(pageNumber(router.query.get("page")));
    const result = resource(async signal => {
        session.user?.id;
        const filter = kind;
        const list = await api.get<Page<Content>>(`/api/me/activity?${new URLSearchParams({ kind: filter, page: String(page), pageSize: "20" })}`, { signal });
        const titles = new Map<string, string>();
        if (filter === "answer") {
            await Promise.all([...new Set(list.items.map(item => item.targetId).filter((id): id is string => Boolean(id)))].map(async id => {
                const parent = await api.get<Content>(`/api/questions/${encode(id)}`, { signal });
                titles.set(id, parent.title ?? "问题");
            }));
        }
        return { list, titles };
    });
    $effect(() => {
        const list = result.data?.list;
        if (list && !result.refreshing && page > pageCount(list)) void updateQuery({ page: pageCount(list) }, { replace: true });
    });
</script>

<PageLayout {title} subtitle={kind === "question" ? "查看你提出的问题与讨论进展。" : "回顾你分享的解答。"}>
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if result.data}
            {@const data = result.data}
            {#if data.list.items.length}
                <p class="summary">共 {data.list.total} 条</p>
                <div class="items">
                    {#each data.list.items as item (item.id)}
                        {#if kind === "question"}<QuestionListItem question={questionView(item)} />
                        {:else}
                            {@const body = validateDoc(item.body)}
                            <article class="answer-item">
                                <Link class="answer-item-link" href={`/answers/${encode(urlId(item.id))}`} aria-label={data.titles.get(item.targetId!) ?? "查看问题与回答"}>
                                    <h2>{data.titles.get(item.targetId!) ?? "查看问题与回答"}</h2>
                                    <p class="excerpt">{body.ok ? toPlainText(body.doc, { maxChars: 220 }) : "正文暂时无法完整显示"}</p>
                                    <div class="metadata"><span>净赞数 {item.score}</span><span>{item.commentCount} 条评论</span><RelativeTime timestamp={item.createdAt} /></div>
                                </Link>
                            </article>
                        {/if}
                    {/each}
                </div>
                {#if pageCount(data.list) > 1}<Pagination page={data.list.page} pageCount={pageCount(data.list)} disabled={result.refreshing}
                    onchange={(next: number) => { void updateQuery({ page: next === 1 ? null : next }, { scroll: "top" }); }} />{/if}
            {:else}<StateBlock kind="empty" title={kind === "question" ? "还没有提问" : "还没有回答"} description="进入课程问答，参与讨论。">
                {#snippet actions()}<Button href="/courses">浏览课程</Button>{/snippet}
            </StateBlock>{/if}
        {/if}
    </ResourceState>
</PageLayout>

<style>
    .summary, .metadata { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .items { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
    .answer-item { border-bottom: 1px solid var(--color-border); }
    .answer-item :global(.answer-item-link) { display: grid; gap: var(--space-3); padding: var(--space-5); color: var(--color-text); text-decoration: none; transition: background var(--duration-fast) var(--ease-out); }
    .answer-item :global(.answer-item-link:hover) { background: var(--color-surface-sunken); text-decoration: none; }
    .answer-item :global(.answer-item-link:active) { background: var(--color-accent-soft); }
    .answer-item :global(.answer-item-link:focus-visible) { outline-offset: -2px; }
    .items :global(article:last-child) { border-bottom: 0; }
    h2 { color: var(--color-accent); font-size: var(--font-size-lg); }
    .excerpt { white-space: pre-line; overflow-wrap: anywhere; }
    .metadata { display: flex; gap: var(--space-4); flex-wrap: wrap; }
</style>