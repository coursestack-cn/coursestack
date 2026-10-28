<script lang="ts">
    import Link from "$lib/components/ui/Link.svelte";
    import { router } from "$lib/router/router.svelte.js";

    const links = [
        { label: "账号管理", href: "/admin/accounts", paths: ["/admin", "/admin/accounts"] },
        { label: "课程管理", href: "/admin/courses", paths: ["/admin/courses"] }
    ];
</script>

<nav class="admin-nav" aria-label="管理端导航">
    {#each links as link (link.href)}
        <Link class="admin-link" href={link.href} aria-current={link.paths.includes(router.pathname) ? "page" : undefined}>{link.label}</Link>
    {/each}
</nav>

<style>
    .admin-nav { display: flex; flex-wrap: wrap; gap: var(--space-1); border-bottom: 1px solid var(--color-border); }
    :global(.admin-link) { padding: var(--space-3) var(--space-4); border-bottom: 2px solid transparent; margin-bottom: -1px; color: var(--color-text-secondary); font-size: var(--font-size-md); transition: background var(--duration-fast) var(--ease-out); }
    :global(.admin-link:hover) { background: var(--color-surface-sunken); color: var(--color-text); text-decoration: none; }
    :global(.admin-link:active) { background: var(--color-accent-soft); }
    :global(.admin-link[aria-current="page"]) { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: var(--font-weight-bold); }
</style>