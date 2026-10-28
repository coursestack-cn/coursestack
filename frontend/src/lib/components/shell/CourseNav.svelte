<script module lang="ts">
    export type Props = { courseCode: string; courseName: string; showManage?: boolean; loading?: boolean };
</script>

<script lang="ts">
    import Link from "$lib/components/ui/Link.svelte";
    import Skeleton from "$lib/components/ui/Skeleton.svelte";
    import { router } from "$lib/router/router.svelte.js";

    let { courseCode, courseName, showManage = false, loading = false }: Props = $props();
    const base = $derived(`/courses/${encodeURIComponent(courseCode)}`);
    const links = $derived([
        { label: "主页", href: base },
        { label: "资料", href: `${base}/materials` },
        { label: "问答", href: `${base}/questions` },
        ...(showManage ? [{ label: "管理", href: `${base}/manage` }] : [])
    ]);
    function active(href: string) {
        return router.pathname === href || (href !== base && router.pathname.startsWith(`${href}/`));
    }
</script>

<nav class="course-nav" aria-label="课程导航">
    <h1 class="course-name" tabindex="-1" aria-busy={loading || undefined} aria-label={loading ? "正在加载课程" : undefined}>
        {#if loading}<Skeleton variant="block" width="8em" height="1.4em" />{:else}{courseName}{/if}
    </h1>
    <div class="links">
        {#each links as link}
            <Link class="course-link" href={link.href} aria-current={active(link.href) ? "page" : undefined}>{link.label}</Link>
        {/each}
    </div>
</nav>

<style>
    .course-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); min-width: 0; padding: var(--space-3) var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .course-name { min-width: 0; font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); overflow-wrap: anywhere; scroll-margin-top: var(--space-6); }
    .course-name:focus:not(:focus-visible) { outline: none; }
    .links { display: flex; flex-wrap: wrap; gap: var(--space-1); }
    :global(.course-link) { padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); color: var(--color-text-secondary); font-size: var(--font-size-md); }
    :global(.course-link:hover) { color: var(--color-accent); background: var(--color-surface-sunken); text-decoration: none; }
    :global(.course-link:active) { background: var(--color-accent-soft); }
    :global(.course-link[aria-current="page"]) { color: var(--color-accent-soft-text); background: var(--color-accent-soft); font-weight: var(--font-weight-bold); }
</style>