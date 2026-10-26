<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";
    import type { BreadcrumbItem } from "$lib/components/ui/Breadcrumb.svelte";

    export type Props = Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
        title: string;
        subtitle?: string;
        breadcrumbs?: BreadcrumbItem[];
        width?: "page" | "prose";
        actions?: Snippet;
        children?: Snippet;
    };
</script>

<script lang="ts">
    import Breadcrumb from "$lib/components/ui/Breadcrumb.svelte";

    let { title, subtitle, breadcrumbs = [], width = "page", actions, children, class: className = "", ...rest }: Props = $props();
</script>

<section {...rest} class={`page-layout ${width} ${className}`}>
    {#if breadcrumbs.length}<Breadcrumb items={breadcrumbs} />{/if}
    <header class="page-heading">
        <div class="heading-copy">
            <h1 tabindex="-1">{title}</h1>
            {#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
        </div>
        {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </header>
    <div class="page-body">{@render children?.()}</div>
</section>

<style>
    .page-layout { width: 100%; max-width: var(--width-page); min-width: 0; margin-inline: auto; padding: var(--space-8) var(--space-6) var(--space-12); display: grid; gap: var(--space-6); }
    .prose { max-width: var(--width-prose); }
    .page-heading { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
    .heading-copy { min-width: 0; display: grid; gap: var(--space-2); }
    h1, .subtitle { overflow-wrap: anywhere; }
    h1 { scroll-margin-top: var(--space-6); }
    h1:focus:not(:focus-visible) { outline: none; }
    .subtitle { color: var(--color-text-secondary); font-size: var(--font-size-md); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); max-width: 100%; }
    .page-body { min-width: 0; display: grid; align-content: start; gap: var(--space-6); }
    @media (max-width: 639px) { .page-layout { padding: var(--space-6) var(--space-4) var(--space-8); gap: var(--space-5); } }
</style>