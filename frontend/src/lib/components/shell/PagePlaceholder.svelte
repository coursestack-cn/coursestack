<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { PageProps } from "$lib/router/types";

    export type Props = PageProps & { title?: string; children?: Snippet };
</script>

<script lang="ts">
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import { getCourse } from "$lib/components/shell/CourseLayout.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import { router, setTitle } from "$lib/router/router.svelte.js";

    let { title, children }: Props = $props();
    const course = getCourse();

    $effect(() => {
        if (course?.data) setTitle(`${course.data.course.name} · ${title ?? router.route.title}`);
    });
</script>

{#snippet placeholder()}
    <div class="placeholder">
        <StateBlock kind="empty" title="此页面尚未实现" />
    </div>
    {@render children?.()}
{/snippet}

{#if course}
    {@render placeholder()}
{:else}
    <PageLayout title={title ?? router.route.title}>{@render placeholder()}</PageLayout>
{/if}

<style>
    .placeholder { border: 1px dashed var(--color-border-strong); border-radius: var(--radius-lg); }
</style>