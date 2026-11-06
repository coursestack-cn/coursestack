<script lang="ts">
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import { type PageProps } from "$lib/router/types";
    import OwnedContentPanel from "./OwnedContentPanel.svelte";
    let { params }: PageProps = $props();
</script>

<PageLayout title="我的内容" width="prose"><OwnedContentPanel id={params.contentId!} /></PageLayout>