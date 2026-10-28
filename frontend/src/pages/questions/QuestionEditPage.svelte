<script lang="ts">
    import QuestionFormPage from "./QuestionFormPage.svelte";
    import type { PageProps } from "$lib/router/types";

    let { params }: PageProps = $props();
</script>

<QuestionFormPage questionId={params.questionId} />