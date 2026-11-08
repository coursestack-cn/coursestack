<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { bonusSourceLabel, signedPoints, type BonusRecord } from "$lib/bonus";
    import { bonusUpdates } from "$lib/bonus-notifications.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import { router, updateQuery } from "$lib/router/router.svelte.js";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { pageNumber, pageCount, type Page, type Term } from "../manage/course";

    let { courseId }: { courseId: string } = $props();
    const page = $derived(pageNumber(router.query.get("bonusPage")));
    const termId = $derived(router.query.get("bonusTerm") ?? "");
    const terms = resource(signal => api.get<Term[]>(`/api/courses/${encodeURIComponent(courseId)}/terms`, { signal }));
    const options = $derived([{ value: "", label: "全部学期" }, ...(terms.data ?? []).map(term => ({ value: term.id, label: `${term.name}${term.current ? "（本学期）" : ""}` })),
        ...(termId && !terms.data?.some(term => term.id === termId) ? [{ value: termId, label: termId }] : [])]);
    const result = resource(async signal => {
        const viewer = session.user?.id, id = courseId, selectedTerm = termId, selectedPage = page;
        bonusUpdates.revision;
        const query = new URLSearchParams({ courseId: id, page: String(selectedPage), pageSize: "10" });
        if (selectedTerm) query.set("termId", selectedTerm);
        const records = await api.get<Page<BonusRecord> & { totalPoints: number }>(`/api/me/bonus-ledger?${query}`, { signal });
        return { ...records, viewer, courseId: id, termId: selectedTerm };
    });
    const current = $derived(result.data?.viewer === session.user?.id && result.data?.courseId === courseId && result.data?.termId === termId ? result.data : undefined);
    $effect(() => {
        if (current && !result.refreshing && current.page === page && page > pageCount(current)) {
            void updateQuery({ bonusPage: pageCount(current) === 1 ? null : pageCount(current) }, { replace: true });
        }
    });
</script>

<div class="history">
        <div class="toolbar">
            <Field label="学期">{#snippet children({ id })}<Select {id} {options} value={termId} onchange={event => { void updateQuery({ bonusTerm: event.currentTarget.value || null, bonusPage: null }); }} />{/snippet}</Field>
            <Button size="sm" loading={result.refreshing} onclick={result.reload}>刷新记录</Button>
        </div>
        {#if terms.error}<p class="hint">学期名称暂时未能加载。<Button size="sm" variant="ghost" onclick={terms.reload}>重试</Button></p>{/if}
        <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
            {#if current}
                <p class="total">{termId ? "所选学期" : "全部学期"} · 净积分 <strong>{current.totalPoints}</strong> · 共 {current.total} 笔记录</p>
                {#if current.items.length}
                    <ol class="records" aria-label="我的加分记录">
                        {#each current.items as record (record.id)}
                            <li>
                                <div class="record-heading"><span>{bonusSourceLabel(record)}</span><strong class:positive={record.deltaPoints > 0}>{signedPoints(record.deltaPoints)} 分</strong></div>
                                {#if record.reason}<p class="reason">{record.reason}</p>{/if}
                                <p class="metadata"><span>{record.termName}</span><time datetime={new Date(record.createdAt * 1000).toISOString()}>{new Date(record.createdAt * 1000).toLocaleString()}</time></p>
                            </li>
                        {/each}
                    </ol>
                    {#if pageCount(current) > 1}<Pagination {page} pageCount={pageCount(current)} disabled={result.refreshing} aria-label="我的加分历史分页"
                        onchange={(next: number) => { void updateQuery({ bonusPage: next === 1 ? null : next }); }} />{/if}
                {:else}<StateBlock kind="empty" title="暂无加分记录" description={termId ? "这个学期还没有积分变动。" : "获得加分后，可以在这里查看原因、分值和时间。"} />{/if}
            {/if}
        </ResourceState>
</div>

<style>
    .total { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .history { display: grid; min-width: 0; gap: var(--space-4); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: var(--space-3); }
    .toolbar > :global(.field) { flex: 1; max-width: 20rem; min-width: 10rem; }
    .records { list-style: none; padding: 0; }
    .records li { display: grid; gap: var(--space-2); padding: var(--space-4) 0; border-bottom: 1px solid var(--color-border); }
    .records li:first-child { padding-top: 0; }
    .record-heading { display: flex; justify-content: space-between; gap: var(--space-4); }
    strong { flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .positive { color: var(--color-success); }
    .reason { overflow-wrap: anywhere; }
    .metadata { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); overflow-wrap: anywhere; }
    .metadata, .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
</style>