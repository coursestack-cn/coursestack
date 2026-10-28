<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ContentState from "./ContentState.svelte";
    import QuestionDetail from "./QuestionDetail.svelte";
    import { courseEntry, encode, type Content } from "./data";
    import type { PageProps } from "$lib/router/types";

    let { params }: PageProps = $props();
    const result = resource(async signal => {
        const id = params.questionId!, viewer = session.user?.id;
        const question = await api.get<Content>(`/api/questions/${encode(id)}`, { signal });
        return { question, entry: await courseEntry(question.courseId, signal), viewer };
    });
</script>

{#if result.data && result.status === "ready"}
    {#key result.data.viewer}<QuestionDetail initial={result.data.question} entry={result.data.entry} />{/key}
{:else}
    <PageLayout title="问题详情" width="prose"><ContentState status={result.status} error={result.error} reload={result.reload} /></PageLayout>
{/if}