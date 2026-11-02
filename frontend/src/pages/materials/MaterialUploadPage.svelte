<script lang="ts">
    import { type PageProps } from "$lib/router/types";
    let {}: PageProps = $props();
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { session } from "$lib/session.svelte";
    import { setTitle } from "$lib/router/router.svelte";
    import { getCourse } from "$lib/components/shell/CourseLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import MaterialForm from "./MaterialForm.svelte";
    import { type MaterialPolicy } from "./data";
    const course = getCourse()!;
    const policy = resource(signal => api.get<MaterialPolicy>("/api/materials/policy", { signal }));
    $effect(() => { if (course.data) setTitle(`上传资料 - ${course.data.course.name}`); });
</script>

<section class="upload-page">
    <h2>上传资料</h2>
    <ResourceState status={policy.status} error={policy.error} reload={policy.reload}>
        {#if course.data && policy.data}{#key session.user?.id}<MaterialForm mode="create" course={course.data.course} policy={policy.data} />{/key}{/if}
    </ResourceState>
</section>

<style>
    .upload-page { display: grid; gap: var(--space-6); min-width: 0; max-width: var(--width-prose); width: 100%; margin-inline: auto; }
    h2 { font-size: var(--font-size-xl); }
</style>