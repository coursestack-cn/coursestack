<script lang="ts">
    import { onDestroy, tick, untrack } from "svelte";
    import { api, ApiError } from "$lib/api/client";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { resource } from "$lib/api/resource.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import { navigate, router, setTitle } from "$lib/router/router.svelte.js";
    import { loginHref } from "$lib/router/urls";
    import { confirmLeave } from "$lib/router/leave.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import Pagination from "$lib/components/ui/Pagination.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import ContentState from "./ContentState.svelte";
    import BodyComposer from "./BodyComposer.svelte";
    import DiscussionBlock from "./DiscussionBlock.svelte";
    import { courseQuestionsHref, encode, findItemPage, locateContent, pageCount, pageNumber, questionHref, urlId, type Content, type CourseEntry, type Page } from "./data";

    let { initial, entry }: { initial: Content; entry: CourseEntry } = $props();
    let question = $state.raw<Content>(untrack(() => initial));
    let unavailable = $state(false);
    let accepting = false;
    const controller = new AbortController();
    onDestroy(() => controller.abort());
    const currentPage = $derived(pageNumber(router.query.get("page")));
    const focus = resource(async signal => {
        const hash = router.hash, id = initial.id;
        let decoded = "";
        try { decoded = decodeURIComponent(hash.slice(1)); } catch { return null; }
        const match = /^(answer|comment)-(.+)$/.exec(decoded);
        if (!match) return null;
        const location = await locateContent(match[2]!, match[1] as "answer" | "comment", signal);
        if (location.root.id !== id || location.root.kind !== "question") throw new ApiError(404, "CONTENT_UNAVAILABLE", "内容不属于此问题");
        const answers = location.answerId ? await findItemPage<Content>(`/api/questions/${encode(id)}/answers`, location.answerId, signal) : null;
        if (location.answerId && !answers) throw new ApiError(404, "CONTENT_UNAVAILABLE", "回答不可用");
        return { ...location, answerPage: answers?.page, hash };
    });
    const activeFocus = $derived(focus.data?.hash === router.hash ? focus.data : null);
    const answers = resource(async signal => {
        const id = initial.id;
        const page = activeFocus?.answerPage ?? currentPage;
        return api.get<Page<Content>>(`/api/questions/${encode(id)}/answers?page=${page}&pageSize=20`, { signal });
    });
    let locatedHash = "";
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    onDestroy(() => clearTimeout(highlightTimer));
    async function locate() {
        const hash = router.hash;
        if (!activeFocus || hash === locatedHash) return;
        await tick();
        if (router.hash !== hash || controller.signal.aborted) return;
        const element = document.getElementById(decodeURIComponent(hash.slice(1)));
        if (!element) return;
        locatedHash = hash;
        element.scrollIntoView({ block: "start", behavior: "instant" });
        element.setAttribute("tabindex", "-1");
        element.focus({ preventScroll: true });
        element.classList.add("question-target");
        clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => { element.classList.remove("question-target"); }, 2500);
    }
    $effect(() => {
        if (!router.hash) locatedHash = "";
    });
    $effect(() => {
        const data = answers.data;
        if (data && !answers.refreshing && activeFocus && !activeFocus.commentId) void locate();
        if (data && !answers.refreshing && !activeFocus && currentPage > pageCount(data)) void goPage(pageCount(data), true);
    });
    $effect(() => { setTitle(question.title ?? "问题详情"); });

    async function goPage(page: number, replace = false) {
        const query = new URLSearchParams(router.query);
        if (page === 1) query.delete("page"); else query.set("page", String(page));
        await navigate(`${questionHref(question.id)}${query.size ? `?${query}` : ""}`, { replace });
    }
    async function refreshQuestion() {
        try { question = await api.get<Content>(`/api/questions/${encode(question.id)}`, { signal: controller.signal }); }
        catch (error) {
            if (error instanceof ApiError && error.code === "CONTENT_UNAVAILABLE") unavailable = true;
            else if (!isAborted(error)) toast.error(userMessage(error));
        }
    }
    function refresh() { void refreshQuestion(); answers.reload(); }
    function removed(id: string) {
        if (id === question.id) { unavailable = true; void navigate(courseQuestionsHref(entry.course)); }
        else refresh();
    }
    async function accept(answerId: string | null) {
        if (accepting) return;
        accepting = true;
        try {
            if (!await confirmLeave(true)) throw new ApiError(0, "ABORTED", "已取消采纳操作");
            question = await api.put<Content>(`/api/questions/${encode(question.id)}/acceptance`, { answerId }, { signal: controller.signal });
            answers.reload();
        } finally { accepting = false; }
    }
    function answered(id?: string) {
        refresh();
        if (id) void navigate(`${questionHref(question.id)}#answer-${encode(urlId(id))}`);
    }
</script>

<svelte:window onpopstate={() => { locatedHash = window.location.hash; }} />

<PageLayout title={question.title ?? "问题详情"} width="prose" breadcrumbs={[
    { label: entry.course.name, href: courseQuestionsHref(entry.course) }, { label: "问题详情" }
]}>
    {#if unavailable}<StateBlock kind="unavailable" title="内容不可用" />
    {:else}
        {#if question.tags?.length}<div class="tags" aria-label="问题标签">{#each question.tags as tag}<Link href={`${courseQuestionsHref(entry.course)}?${new URLSearchParams({ tag })}`}>{tag}</Link>{/each}</div>{/if}
        <DiscussionBlock content={question} canManage={entry.permissions.canManage}
            focusComment={!activeFocus?.answerId ? activeFocus?.commentId : undefined} onchange={refresh} onremove={removed} onlocated={() => { void locate(); }} />
        {#if focus.status === "error"}<div class="focus-error"><ContentState status="error" error={focus.error} reload={focus.reload} /></div>{/if}
        <section class="answers" aria-label="回答列表">
            <div class="answers-heading"><h2>{question.answerCount ?? answers.data?.total ?? ""} 个回答</h2><span>采纳优先 · 其余按净赞数</span></div>
            <ContentState status={answers.status} error={answers.error} refreshing={answers.refreshing} reload={answers.reload}>
                {#if answers.data}
                    {#each answers.data.items as answer (answer.id)}
                        <DiscussionBlock content={{ ...answer, isAccepted: question.acceptedAnswerId === answer.id }} canManage={entry.permissions.canManage}
                            otherAccepted={Boolean(question.acceptedAnswerId && question.acceptedAnswerId !== answer.id)}
                            focusComment={activeFocus?.answerId === answer.id ? activeFocus.commentId : undefined}
                            onaccept={() => accept(answer.id)} onunaccept={() => accept(null)} onchange={refresh} onremove={removed} onlocated={() => { void locate(); }} />
                    {:else}<StateBlock kind="empty" title="还没有回答" description="分享你的思路，帮助大家理解这个问题。" />{/each}
                    {#if pageCount(answers.data) > 1}<Pagination page={answers.data.page} pageCount={pageCount(answers.data)} disabled={answers.refreshing} onchange={(page: number) => { void goPage(page); }} />{/if}
                {/if}
            </ContentState>
        </section>
        <section class="answer-composer" aria-label="撰写回答">
            <h2>你的回答</h2>
            {#if session.user}<BodyComposer label="发布回答" path={`/api/questions/${encode(question.id)}/answers`} oncomplete={answered} />
            {:else}<StateBlock kind="login-required" title="登录后参与讨论" description="登录后可以回答问题、发表评论和投票。">
                {#snippet actions()}<Button variant="primary" href={loginHref(router.href)}>去登录</Button>{/snippet}
            </StateBlock>{/if}
        </section>
    {/if}
</PageLayout>

<style>
    .tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .tags :global(a) { padding: var(--space-1) var(--space-3); border-radius: var(--radius-md); background: var(--color-accent-soft); font-size: var(--font-size-sm); }
    .answers, .answer-composer { display: grid; gap: var(--space-5); min-width: 0; }
    .answers-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
    .answers-heading span { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .answer-composer { padding-top: var(--space-4); border-top: 1px solid var(--color-border); }
    h2 { font-size: var(--font-size-xl); }
    :global(.content-block.question-target), :global(.comment-item.question-target) { background: var(--color-accent-soft); }
</style>