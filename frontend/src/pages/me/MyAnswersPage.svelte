<script lang="ts">
    import MyDiscussionPage from "../questions/MyDiscussionPage.svelte";
    import type { PageProps } from "$lib/router/types";
    let {}: PageProps = $props();
</script>

<MyDiscussionPage kind="answer" />