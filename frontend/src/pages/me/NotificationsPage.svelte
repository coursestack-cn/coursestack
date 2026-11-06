<script lang="ts">
    import { untrack } from "svelte";
    import { api } from "$lib/api/client";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte";
    import { router, updateQuery, navigate } from "$lib/router/router.svelte";
    import { beginNotificationCount, notificationUpdates, publishNotificationCount } from "$lib/notifications.svelte";
    import { matchesNoticeFilter, mergeNotices, noticeHeading, type Notice, type NoticeBatch, type NoticeFilter } from "$lib/notification-list";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Tabs from "$lib/components/ui/Tabs.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import { type PageProps } from "$lib/router/types";
    let {}: PageProps = $props();

    const filter = $derived((['unread', 'read', 'all'].includes(router.query.get('status') ?? '') ? router.query.get('status') : 'unread') as NoticeFilter);
    const unreadCount = $derived(notificationUpdates.viewer === session.user?.id ? notificationUpdates.unreadCount : 0);
    let items = $state<Notice[]>([]), nextCursor = $state<number | null>(null);
    let loading = $state(true), refreshing = $state(false), waiting = $state(false);
    let error = $state<string | null>(null), pending = $state<number | "all" | null>(null);
    let controller: AbortController;
    let load: (mode?: "refresh" | "more" | "reset") => Promise<void> = async () => {};

    $effect(() => {
        const viewer = session.user?.id, status = filter;
        untrack(() => { items = []; nextCursor = null; loading = true; refreshing = false; waiting = false; error = null; pending = null; });
        const active = new AbortController(); controller = active;
        let timer: ReturnType<typeof setTimeout> | undefined, busy = false;
        const current = () => !active.signal.aborted && session.user?.id === viewer;
        const schedule = () => {
            clearTimeout(timer);
            if (current() && document.visibilityState === "visible") timer = setTimeout(() => { void run(); }, 60_000);
        };
        async function run(mode: "refresh" | "more" | "reset" = "refresh") {
            if (!viewer || !current() || busy || pending !== null) return;
            if (mode === "more" && nextCursor === null) return;
            busy = true; refreshing = true; error = null; clearTimeout(timer);
            const previous = [...items], cursor = nextCursor, countRequest = beginNotificationCount();
            try {
                const batch = await api.get<NoticeBatch>(`/api/notifications?status=${status}${mode === "more" ? `&beforeId=${cursor}` : ""}`, { signal: active.signal });
                if (!current() || batch.viewer !== viewer) return;
                const updated: Notice[] = [];
                if (mode === "refresh") {
                    for (let index = 0; index < previous.length; index += 20) {
                        const ids = previous.slice(index, index + 20).map(item => item.id).join(",");
                        const state = await api.get<{ viewer: string; items: Notice[] }>(`/api/notifications/state?ids=${ids}`, { signal: active.signal });
                        if (!current() || state.viewer !== viewer) return;
                        updated.push(...state.items);
                    }
                }
                if (!current()) return;
                publishNotificationCount(viewer, batch.unreadCount, countRequest);
                if (mode === "reset" || previous.length === 0) {
                    items = batch.items; nextCursor = batch.nextCursor; waiting = false;
                } else if (mode === "more") {
                    items = [...new Map([...previous, ...batch.items].map(item => [item.id, item])).values()].sort((a, b) => b.id - a.id);
                    nextCursor = batch.nextCursor;
                } else {
                    const merged = mergeNotices(previous, batch, updated, status);
                    items = merged.items; waiting = merged.waiting;
                }
            } catch (cause) {
                if (current() && !isAborted(cause)) error = userMessage(cause);
            } finally {
                busy = false;
                if (current()) { loading = false; refreshing = false; schedule(); }
            }
        }
        load = run;
        const wake = () => {
            clearTimeout(timer);
            if (document.visibilityState === "visible") void run();
        };
        untrack(() => { void run("reset"); });
        document.addEventListener("visibilitychange", wake);
        window.addEventListener("focus", wake);
        window.addEventListener("online", wake);
        return () => {
            active.abort(); clearTimeout(timer);
            document.removeEventListener("visibilitychange", wake);
            window.removeEventListener("focus", wake);
            window.removeEventListener("online", wake);
        };
    });

    async function read(item?: Notice, open = false) {
        if (pending !== null || refreshing) return;
        const throughId = items[0]?.id, viewer = session.user?.id, active = controller;
        if (!viewer || (!item && throughId === undefined)) return;
        pending = item?.id ?? "all";
        try {
            if (item) {
                const result = await api.put<{ readAt: number; unreadCount: number }>(`/api/notifications/${item.id}/read`, {}, { signal: active.signal });
                if (active.signal.aborted || session.user?.id !== viewer) return;
                items = items.map(row => row.id === item.id ? { ...row, readAt: result.readAt } : row).filter(row => matchesNoticeFilter(row, filter));
                publishNotificationCount(viewer, result.unreadCount);
                if (open && item.href) await navigate(item.href);
            } else {
                const result = await api.put<{ unreadCount: number }>("/api/notifications/read", { throughId }, { signal: active.signal });
                if (active.signal.aborted || session.user?.id !== viewer) return;
                const at = Math.floor(Date.now() / 1000);
                items = items.map(row => row.id <= throughId! ? { ...row, readAt: row.readAt ?? at } : row).filter(row => matchesNoticeFilter(row, filter));
                publishNotificationCount(viewer, result.unreadCount);
            }
        } catch (cause) {
            if (!active.signal.aborted && !isAborted(cause)) toast.error(userMessage(cause));
        } finally {
            if (!active.signal.aborted) { pending = null; void load(); }
        }
    }
</script>

<PageLayout title="通知" width="prose">
    <div class="toolbar">
        <p class="summary">{unreadCount} 条未读通知</p>
        <div class="actions">
            <Button size="sm" variant="ghost" disabled={refreshing || pending !== null} onclick={() => { void load("reset"); }}>刷新</Button>
            {#if filter !== "read"}<Button size="sm" disabled={loading || refreshing || pending !== null || items.length === 0 || unreadCount === 0} loading={pending === "all"} onclick={() => { void read(); }}>全部已读</Button>{/if}
        </div>
    </div>
    <Tabs value={filter} label="通知筛选" items={[{ value: "unread", label: "未读" }, { value: "read", label: "已读" }, { value: "all", label: "全部" }]}
        onchange={value => { void updateQuery({ status: value === "unread" ? null : value, page: null }); }}>
        {#snippet children()}
            <div class="notices" aria-busy={loading || refreshing}>
                {#if waiting}<div class="new-notices"><span>有新通知可查看</span><Button size="sm" disabled={refreshing || pending !== null} onclick={() => { void load("reset"); }}>查看最新</Button></div>{/if}
                {#if error}<div class="load-error" role="status"><p>{error}</p><Button size="sm" disabled={refreshing} onclick={() => { void load(items.length ? "refresh" : "reset"); }}>重试</Button></div>{/if}
                {#if loading}<StateBlock kind="loading" title="正在加载通知" />
                {:else}
                    {#each items as item (item.id)}
                        <article data-notification-id={item.id} class:unread={item.readAt === null}>
                            <header><h2>{noticeHeading(item)}</h2>{#if item.readAt === null}<span>未读</span>{/if}</header>
                            <p class="context content-context"><span>{item.courseName}</span>{#if item.available}<span>{item.title ?? ({ answer: "回答", comment: "评论", question: "问题", material: "资料" }[item.kind ?? "question"])}</span>{/if}</p>
                            {#if item.contentId && !item.available}<p class="context">该内容已不可查看</p>{/if}
                            {#if item.type === "moderation" && item.status === "visible" && !item.isPublic && item.contentStatus !== "deleted"}
                                <p class="context">{item.contentStatus === "visible" ? "仍受所属内容限制，暂未公开。" : "内容目前仍未公开。"}</p>
                            {/if}
                            {#if item.reason}<p class="reason">{item.type === "bonus" ? "说明" : "原因"}：{item.reason}</p>{/if}
                            <footer><RelativeTime timestamp={item.createdAt} /><div class="actions">
                                {#if item.readAt === null}<Button size="sm" variant="ghost" loading={pending === item.id} disabled={refreshing || pending !== null} onclick={() => { void read(item); }}>标为已读</Button>{/if}
                                {#if item.href}<Button size="sm" disabled={refreshing || pending !== null} onclick={() => { void read(item, true); }}>{item.type === "bonus" ? "查看加分历史" : item.type === "moderation" ? "查看我的内容" : "查看内容"}</Button>{/if}
                            </div></footer>
                        </article>
                    {:else}{#if !error}<StateBlock kind="empty" title={filter === "unread" ? "暂无未读通知" : "暂无通知"} />{/if}{/each}
                    {#if nextCursor !== null}<Button loading={refreshing} disabled={pending !== null || refreshing} onclick={() => { void load("more"); }}>加载更多</Button>
                    {:else if items.length}<p class="end">已全部加载</p>{/if}
                {/if}
            </div>
        {/snippet}
    </Tabs>
</PageLayout>

<style>
    .notices { display: grid; gap: var(--space-3); }
    .toolbar, header, footer, .new-notices { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .content-context { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    article { display: grid; gap: var(--space-3); padding: var(--space-5); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
    article.unread { border-inline-start: 3px solid var(--color-accent); }
    h2 { font-size: var(--font-size-lg); }
    header span { color: var(--color-accent); font-size: var(--font-size-sm); }
    footer, .summary, .context, .end { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .end { text-align: center; }
    p { overflow-wrap: anywhere; }
    .reason { white-space: pre-line; }
    .load-error { display: grid; justify-items: start; gap: var(--space-2); color: var(--color-danger); }
</style>