<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { displayName } from "$lib/content/display-name";
    import { setTitle } from "$lib/router/router.svelte.js";
    import type { PageProps } from "$lib/router/types";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import Avatar from "$lib/components/ui/Avatar.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Skeleton from "$lib/components/ui/Skeleton.svelte";
    import TeacherActivity from "./TeacherActivity.svelte";
    import type { TeacherCounts, TeacherProfile } from "./data";

    let { params }: PageProps = $props();
    const result = resource(async signal => {
        const path = `/api/teachers/${encodeURIComponent(params.teacherId!)}`;
        const [teacher, counts] = await Promise.all([
            api.get<TeacherProfile>(path, { signal }), api.get<TeacherCounts>(`${path}/counts`, { signal })
        ]);
        return { teacher, counts };
    });
    const name = $derived(result.data ? displayName(result.data.teacher) : "教师主页");
    $effect(() => { if (result.data) setTitle(`${name}的主页`); });
</script>

<PageLayout title={name} loading={result.status === "loading"}>
    {#snippet heading()}
        <header class="teacher-heading">
            {#if result.data}
                <Avatar size="lg" name={result.data.teacher.nickname ?? ""} accountId={result.data.teacher.id} src={result.data.teacher.avatarUrl ?? undefined} alt="" aria-hidden="true" />
            {:else if result.status === "loading"}<Skeleton variant="circle" width="var(--space-12)" height="var(--space-12)" />{/if}
            <h1 tabindex="-1">{#if result.status === "loading"}<Skeleton variant="block" width="8em" height="1.4em" />{:else}{name}{/if}</h1>
            {#if result.data}<Badge tone="teacher">教师</Badge>{/if}
        </header>
    {/snippet}
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {#if result.data}<TeacherActivity teacherId={result.data.teacher.id} counts={result.data.counts} />{/if}
    </ResourceState>
</PageLayout>

<style>
    .teacher-heading { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-4); min-width: 0; }
    h1 { min-width: 0; overflow-wrap: anywhere; }
    h1:focus:not(:focus-visible) { outline: none; }
</style>