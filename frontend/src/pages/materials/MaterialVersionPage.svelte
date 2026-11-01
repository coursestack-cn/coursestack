<script lang="ts">
    import { navigate, router } from "$lib/router/router.svelte";
    import { type PageProps } from "$lib/router/types";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import { materialHref } from "./data";
    let { params }: PageProps = $props();
    $effect(() => { void navigate(`${materialHref(params.materialId!)}?${new URLSearchParams({ version: params.versionId! })}${router.hash}`, { replace: true }); });
</script>

<PageLayout title="资料版本"><ResourceState status="loading" /></PageLayout>