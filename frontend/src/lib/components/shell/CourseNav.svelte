<script module lang="ts">
    import type { Snippet } from "svelte";
    export type Props = { courseCode: string; courseName: string; manageHref?: string; loading?: boolean; showBack?: boolean; actions?: Snippet };
</script>

<script lang="ts">
    import Button from "$lib/components/ui/Button.svelte";
    import Skeleton from "$lib/components/ui/Skeleton.svelte";
    import { router } from "$lib/router/router.svelte";

    let { courseCode, courseName, manageHref, loading = false, showBack = true, actions }: Props = $props();
    const base = $derived(`/courses/${encodeURIComponent(courseCode)}`);
</script>

<header class="course-heading">
    <h1 tabindex="-1">{#if loading}<Skeleton variant="block" width="8em" height="1.4em" />{:else}{courseName}{/if}</h1>
    <div class="actions">
        {@render actions?.()}
        {#if showBack && router.pathname !== base}<Button href={base}>返回课程</Button>{/if}
        {#if manageHref}<Button href={`${base}/manage/reports`}>内容审查</Button><Button href={manageHref}>管理课程</Button>{/if}
    </div>
</header>

<style>
    .course-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); min-width: 0; }
    h1 { min-width: 0; overflow-wrap: anywhere; scroll-margin-top: var(--space-6); }
    h1:focus:not(:focus-visible) { outline: none; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; max-width: 100%; margin-inline-start: auto; }
    @media (max-width: 639px) { .actions { width: 100%; } }
</style>