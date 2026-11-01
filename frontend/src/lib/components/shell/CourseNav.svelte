<script module lang="ts">
    export type Props = { courseCode: string; courseName: string; showManage?: boolean; loading?: boolean };
</script>

<script lang="ts">
    import Button from "$lib/components/ui/Button.svelte";
    import Skeleton from "$lib/components/ui/Skeleton.svelte";
    import { router } from "$lib/router/router.svelte";

    let { courseCode, courseName, showManage = false, loading = false }: Props = $props();
    const base = $derived(`/courses/${encodeURIComponent(courseCode)}`);
</script>

<header class="course-heading">
    <h1 tabindex="-1">{#if loading}<Skeleton variant="block" width="8em" height="1.4em" />{:else}{courseName}{/if}</h1>
    <div class="actions">
        {#if router.pathname !== base}<Button href={base} variant="ghost">返回课程</Button>{/if}
        {#if showManage}<Button href={`${base}/manage`} variant="ghost">管理课程</Button>{/if}
    </div>
</header>

<style>
    .course-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); min-width: 0; }
    h1 { min-width: 0; overflow-wrap: anywhere; scroll-margin-top: var(--space-6); }
    h1:focus:not(:focus-visible) { outline: none; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>