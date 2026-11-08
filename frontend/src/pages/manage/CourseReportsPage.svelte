<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { session } from "$lib/session.svelte";
    import { router, updateQuery } from "$lib/router/router.svelte";
    import { type PageProps } from "$lib/router/types";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import Tabs from "$lib/components/ui/Tabs.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import { toPlainText } from "$lib/rich-text/index";
    import { pageCount, pageNumber, type Content, type Page } from "../questions/data";
    import ContentReview from "./ContentReview.svelte";
    import ManageNav from "./ManageNav.svelte";
    import { courseManageHref, type Course } from "./course";

    type Item = { id: string; contentId?: string; kind?: Content["kind"]; title?: string | null; body?: Content["body"]; reason?: string; status: string; createdAt: number; resolution?: string | null };
    let { params }: PageProps = $props();
    const allowed = $derived(session.hasRole("admin") || session.hasRole("teacher"));
    const tab = $derived(router.query.get("tab") === "contents" ? "contents" : "reports");
    const state = $derived(router.query.get("status") ?? (tab === "contents" ? "hidden" : "pending"));
    const kind = $derived(router.query.get("kind") ?? "");
    const selected = $derived(router.query.get("content") ?? "");
    const reportId = $derived(router.query.get("report") ?? undefined);
    const page = $derived(pageNumber(router.query.get("page")));
    const statuses = $derived(tab === "contents" ? [{ value: "hidden", label: "已下架" }, { value: "visible", label: "已上架" }, { value: "deleted", label: "已删除" }, { value: "all", label: "全部状态" }]
        : [{ value: "pending", label: "待处理" }, { value: "resolved", label: "已下架处理" }, { value: "deleted", label: "已删除处理" }, { value: "dismissed", label: "已维持现状" }, { value: "all", label: "全部举报" }]);
    const tabs = [{ value: "reports", label: "举报处理" }, { value: "contents", label: "内容管理" }];
    const kinds = [{ value: "", label: "全部类型" }, { value: "material", label: "资料" }, { value: "question", label: "问题" }, { value: "answer", label: "回答" }, { value: "comment", label: "评论" }];
    const result = resource(async signal => {
        const viewer = session.user?.id, mode = tab;
        if (!allowed) return null;
        const query = new URLSearchParams({ status: state, page: String(page), pageSize: "20" });
        if (params.courseCode) query.set("courseId", params.courseCode);
        if (mode === "contents" && kind) query.set("kind", kind);
        return { ...await api.get<Page<Item>>(`/api/moderation/${mode}?${query}`, { signal }), viewer };
    });
    const course = resource(async signal => {
        const code = params.courseCode;
        if (!code) return null;
        return (await api.get<{ course: Course }>(`/api/courses/${encodeURIComponent(code)}/entry`, { signal })).course;
    });
    const breadcrumbs = $derived(params.courseCode ? [{ label: "课程管理", href: "/manage/courses" },
        { label: course.data?.name ?? params.courseCode, href: course.data ? courseManageHref(course.data, session.user) : undefined }, { label: "内容审查" }] : []);
    function complete() {
        result.reload();
        if (reportId) void updateQuery({ report: null, content: null });
    }
</script>

<PageLayout title="内容审查" subtitle={params.courseCode ? undefined : "查看授权课程的举报与下架内容。"} {breadcrumbs}>
    <ManageNav />
    {#if !allowed}<StateBlock kind="forbidden" description="需要当前课程教师或管理员权限。" />{:else}
        <Tabs items={tabs} value={tab} label="内容审查" onchange={next => { void updateQuery({ tab: next === "reports" ? null : next, status: null, page: null, content: null, report: null }); }}>
            <div class="tab-content">
                <div class="filters">
                    <Field label="状态">{#snippet children({ id })}<Select {id} options={statuses} value={state} fitOptions onchange={event => { void updateQuery({ status: event.currentTarget.value, page: null }); }} />{/snippet}</Field>
                    {#if tab === "contents"}<Field label="内容类型">{#snippet children({ id })}<Select {id} options={kinds} value={kind} fitOptions onchange={event => { void updateQuery({ kind: event.currentTarget.value || null, page: null }); }} />{/snippet}</Field>{/if}
                </div>
                <div class:has-selection={Boolean(selected)} class="columns">
                    <section class="queue">
                        <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
                            {#if result.data?.viewer === session.user?.id && result.data}
                                {#each result.data.items as item (item.id)}
                                    <article class:selected={selected === (item.contentId ?? item.id)}>
                                        <h2>{item.title ?? (item.kind ? kinds.find(k => k.value === item.kind)?.label : "内容举报")}</h2>
                                        <p class="excerpt">{item.reason !== undefined ? item.reason || "未填写举报理由" : item.body ? toPlainText(item.body, { maxChars: 120 }) : "正文已删除"}</p>
                                        {#if item.resolution}<p>处理说明：{item.resolution}</p>{/if}
                                        <footer><RelativeTime timestamp={item.createdAt} /><Button size="sm" onclick={() => { void updateQuery({ content: item.contentId ?? item.id, report: tab === "reports" && item.status === "pending" ? item.id : null }); }}>查看内容</Button></footer>
                                    </article>
                                {:else}<StateBlock kind="empty" title="没有符合条件的内容" />{/each}
                                <Pagination {page} pageCount={pageCount(result.data)} disabled={result.refreshing} onchange={(next: number) => { void updateQuery({ page: next, content: null, report: null }); }} />
                            {/if}
                        </ResourceState>
                    </section>
                    {#if selected}<section class="detail">{#key `${selected}:${reportId}`}<ContentReview id={selected} {reportId} oncomplete={complete} />{/key}</section>{/if}
                </div>
            </div>
        </Tabs>
    {/if}
</PageLayout>

<style>
    .tab-content { display: grid; gap: var(--space-6); }
    .filters { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-3); }
    .columns { display: grid; gap: var(--space-6); align-items: start; }
    .columns.has-selection { grid-template-columns: minmax(16rem, 1fr) minmax(0, 2fr); }
    .queue, .detail { min-width: 0; }
    .queue article { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); margin-bottom: var(--space-3); }
    .queue article.selected { border-color: var(--color-accent); }
    h2 { font-size: var(--font-size-lg); overflow-wrap: anywhere; }
    .excerpt { overflow-wrap: anywhere; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    @media (max-width: 899px) { .columns.has-selection { grid-template-columns: minmax(0, 1fr); } .detail { grid-row: 1; } }
</style>