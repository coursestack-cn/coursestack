<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { session } from "$lib/session.svelte";
    import { setTitle } from "$lib/router/router.svelte";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import ContentState from "../questions/ContentState.svelte";
    import { courseEntry, courseQuestionsHref } from "../questions/data";
    import MaterialForm from "./MaterialForm.svelte";
    import { getMaterial, materialHref, type MaterialPolicy } from "./data";
    let { materialId, mode }: { materialId: string; mode: "edit" | "version" } = $props();
    const title = $derived(mode === "edit" ? "编辑资料" : "上传新版本");
    const result = resource(async signal => {
        const id = materialId, currentMode = mode, viewer = session.user?.id;
        const material = await getMaterial(id, undefined, signal);
        const [entry, policy] = await Promise.all([courseEntry(material.courseId, signal), currentMode === "version" ? api.get<MaterialPolicy>("/api/materials/policy", { signal }) : undefined]);
        return { material, entry, policy, viewer, allowed: currentMode === "edit" ? material.permissions.canEdit : material.permissions.canUploadVersion };
    });
    $effect(() => { if (result.data) setTitle(`${title} - ${result.data.material.title}`); });
</script>

<PageLayout {title} width="prose" breadcrumbs={result.data ? [{ label: result.data.entry.course.name, href: courseQuestionsHref(result.data.entry.course) }, { label: result.data.material.title, href: materialHref(result.data.material.id) }, { label: title }] : []}>
    <ContentState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if result.data}
            {#if result.data.allowed}{#key result.data.viewer}<MaterialForm {mode} course={result.data.entry.course} material={result.data.material} policy={result.data.policy} />{/key}
            {:else}<StateBlock kind="forbidden" />{/if}
        {/if}
    </ContentState>
</PageLayout>