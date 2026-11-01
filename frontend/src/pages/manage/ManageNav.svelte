<script lang="ts">
    import Link from "$lib/components/ui/Link.svelte";
    import { router } from "$lib/router/router.svelte.js";
    import { session } from "$lib/session.svelte.js";

    const links = [
        { label: "账号管理", href: "/manage/accounts" },
        { label: "课程管理", href: "/manage/courses" }
    ];
</script>

{#if session.hasRole("admin")}
    <nav class="manage-nav" aria-label="管理导航">
        {#each links as link (link.href)}
            <Link class="manage-link" href={link.href} aria-current={router.pathname === link.href ? "page" : undefined}>{link.label}</Link>
        {/each}
    </nav>
{/if}

<style>
    .manage-nav { display: flex; flex-wrap: wrap; gap: var(--space-1); border-bottom: 1px solid var(--color-border); }
    :global(.manage-link) { padding: var(--space-3) var(--space-4); border-bottom: 2px solid transparent; margin-bottom: -1px; color: var(--color-text-secondary); font-size: var(--font-size-md); transition: background var(--duration-fast) var(--ease-out); }
    :global(.manage-link:hover) { background: var(--color-surface-sunken); color: var(--color-text); text-decoration: none; }
    :global(.manage-link:active) { background: var(--color-accent-soft); }
    :global(.manage-link[aria-current="page"]) { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: var(--font-weight-bold); }
</style>