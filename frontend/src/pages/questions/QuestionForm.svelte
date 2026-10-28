<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { api } from "$lib/api/client";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { redirect } from "$lib/router/router.svelte.js";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import RichTextEditor from "$lib/rich-text/RichTextEditor.svelte";
    import { isEmptyDoc, validateDoc, type RichTextDoc } from "$lib/rich-text/index";
    import { validateTags } from "$lib/content/tag-input";
    import Field from "$lib/components/ui/Field.svelte";
    import TextInput from "$lib/components/ui/TextInput.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import TagInput from "$lib/components/content/TagInput.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import { courseQuestionsHref, emptyDoc, encode, publisher, questionHref, type Content, type Course } from "./data";

    let { course, question }: { course: Course; question?: Content } = $props();
    let title = $state<string | number>(untrack(() => question?.title ?? ""));
    let body = $state<RichTextDoc | null>(untrack(() => JSON.parse(JSON.stringify(question?.body ?? emptyDoc()))));
    let tags = $state<string[]>(untrack(() => [...(question?.tags ?? [])]));
    let valid = $state(false), pending = $state(false), saved = $state(false);
    let error = $state("");
    const initial = untrack(() => JSON.stringify([title, body, tags]));
    const invalidInitial = untrack(() => question?.body != null && !validateDoc(question.body).ok);
    const titleError = $derived(!String(title).trim() ? "填写问题标题" : String(title).trim().length > 200 ? "标题最多 200 个字符" : undefined);
    const tagsError = $derived(validateTags(tags));
    const dirty = $derived(!saved && JSON.stringify([title, body, tags]) !== initial);
    const request = publisher(), controller = new AbortController();
    onDestroy(() => controller.abort());
    onBeforeLeave(() => !dirty && !pending);

    async function submit() {
        if (pending || !session.user || invalidInitial || titleError || tagsError || !valid || !body || isEmptyDoc(body) || !validateDoc(body).ok) return;
        pending = true;
        error = "";
        const data = { title: String(title).trim(), body, tags };
        try {
            const result = question ? await api.patch<{ id: string }>(`/api/contents/${encode(question.id)}`, data, { signal: controller.signal })
                : await request.post<{ id: string }>(`/api/courses/${encode(course.id)}/questions`, data, session.user.id, controller.signal);
            if (controller.signal.aborted) return;
            saved = true;
            pending = false;
            toast.success(question ? "已保存修改" : "已发布问题");
            redirect(questionHref(result.id));
        } catch (cause) {
            if (!isAborted(cause)) error = userMessage(cause, { CONTENT_UNAVAILABLE: "问题已不可用，返回课程问答查看。" });
        } finally { pending = false; }
    }
</script>

{#if invalidInitial}
    <StateBlock kind="error" title="这篇正文暂时无法编辑" description="原正文包含当前编辑器不支持的格式，暂未更改任何内容。" />
{:else}
    <form class="question-form" aria-busy={pending || undefined} onsubmit={event => { event.preventDefault(); void submit(); }} novalidate>
        <Field label="问题标题" required help="用一句话说明遇到的问题，最多 200 个字符。" error={String(title).length > 200 ? titleError : undefined}>
            {#snippet children({ id, describedBy, invalid })}<TextInput {id} {invalid} aria-describedby={describedBy} bind:value={title} disabled={pending} placeholder="你想讨论什么问题？" />{/snippet}
        </Field>
        <Field label="问题正文" required help="说明背景、已经尝试的方法和具体疑问。可以插入公式、代码和资料链接。">
            {#snippet children(control)}<RichTextEditor {...control} bind:value={body} disabled={pending} onstatechange={state => { valid = state.valid; }} onsubmit={() => { void submit(); }} />{/snippet}
        </Field>
        <Field label="标签" error={tagsError}>{#snippet children(control)}<TagInput {...control} bind:value={tags} disabled={pending} />{/snippet}</Field>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="actions">
            <Button type="submit" variant="primary" loading={pending} disabled={Boolean(titleError || tagsError) || !valid || !body || isEmptyDoc(body)}>{question ? "保存修改" : "发布问题"}</Button>
            <Button disabled={pending} href={question ? questionHref(question.id) : courseQuestionsHref(course)}>取消</Button>
        </div>
    </form>
{/if}

<style>
    .question-form { display: grid; gap: var(--space-6); min-width: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .error { color: var(--color-danger); }
</style>