<script lang="ts">
    import ContentRedirect from "./ContentRedirect.svelte";
    import type { PageProps } from "$lib/router/types";

    let { params }: PageProps = $props();
</script>

<ContentRedirect id={params.answerId!} kind="answer" />