<script lang="ts">
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import NotFoundContent from "$lib/components/shell/NotFoundContent.svelte";
    import type { PageProps } from "$lib/router/types";

    let {}: PageProps = $props();
</script>

<PageLayout title="页面未找到"><NotFoundContent /></PageLayout>