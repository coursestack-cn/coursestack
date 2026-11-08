<script lang="ts">
    import { resource } from "$lib/api/resource.svelte";
    import { session } from "$lib/session.svelte";
    import { router } from "$lib/router/router.svelte";
    import { type PageProps } from "$lib/router/types";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import ContentState from "../questions/ContentState.svelte";
    import { courseEntry } from "../questions/data";
    import { getMaterial, materialHref, selectedNumber } from "./data";
    import MaterialDetail from "./MaterialDetail.svelte";

    let { params }: PageProps = $props();
    const materialId = $derived(params.materialId!);
    const version = $derived(router.query.get("version"));
    const result = resource(async signal => {
        const id = materialId, selectedVersion = version, viewer = session.user?.id;
        const material = await getMaterial(id, selectedNumber(selectedVersion), signal);
        return { material, entry: await courseEntry(material.courseId, signal), viewer };
    });
</script>

{#if result.data && result.status === "ready"}
    {#key result.data.viewer}<MaterialDetail material={result.data.material} entry={result.data.entry} refreshing={result.refreshing} reload={result.reload} />{/key}
{:else}
    <PageLayout title="资料详情" style="max-width: 1280px;">
        {#if result.error?.code === "FILE_VERSION_UNAVAILABLE"}
            <StateBlock kind="unavailable" title="此版本已不可用" description="版本可能已被删除，可以返回资料查看现存版本。">
                {#snippet actions()}<Button href={materialHref(params.materialId!)}>查看资料</Button>{/snippet}
            </StateBlock>
        {:else}<ContentState status={result.status} error={result.error} reload={result.reload} />{/if}
    </PageLayout>
{/if}