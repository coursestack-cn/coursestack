<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { setTitle } from "$lib/router/router.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import ContentState from "./ContentState.svelte";
    import QuestionForm from "./QuestionForm.svelte";
    import { courseByCode, courseEntry, courseQuestionsHref, encode, questionHref, type Content } from "./data";

    let { courseCode, questionId }: { courseCode?: string; questionId?: string } = $props();
    const title = $derived(questionId ? "编辑问题" : "提出问题");
    const result = resource(async signal => {
        const id = questionId, code = courseCode, viewer = session.user?.id;
        if (id) {
            const question = await api.get<Content>(`/api/questions/${encode(id)}`, { signal });
            const entry = await courseEntry(question.courseId, signal);
            return { entry, question, viewer, allowed: question.author.id === viewer || entry.permissions.canManage };
        }
        return { entry: await courseByCode(code!, signal), question: undefined, viewer, allowed: Boolean(viewer) };
    });
    $effect(() => { if (result.data) setTitle(`${title} · ${result.data.entry.course.name}`); });
</script>

<PageLayout {title} width="prose" breadcrumbs={result.data ? [
    { label: result.data.entry.course.name, href: courseQuestionsHref(result.data.entry.course) },
    ...(result.data.question ? [{ label: result.data.question.title ?? "问题", href: questionHref(result.data.question.id) }] : []),
    { label: title }
] : []}>
    <ContentState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if result.data}
            {#if result.data.allowed}{#key result.data.viewer}<QuestionForm course={result.data.entry.course} question={result.data.question} />{/key}
            {:else}<StateBlock kind="forbidden" />{/if}
        {/if}
    </ContentState>
</PageLayout>