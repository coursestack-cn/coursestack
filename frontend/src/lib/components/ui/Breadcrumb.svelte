<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type BreadcrumbItem = { label: string; href?: string };
    export type Props = Omit<HTMLAttributes<HTMLElement>, "children"> & { items: BreadcrumbItem[] };
</script>

<script lang="ts">
    import { ChevronRight, Ellipsis } from "@lucide/svelte";
    import Link from "$lib/components/ui/Link.svelte";

    let { items, class: className = "", ...rest }: Props = $props();
</script>

<nav {...rest} class={`breadcrumb ${className}`} aria-label={rest["aria-label"] ?? "面包屑"}>
    <ol>
        {#each items as item, index}
            {#if index === 1 && items.length > 2}
                <li class="collapsed">
                    <ChevronRight size="1em" aria-hidden="true" />
                    <details>
                        <summary aria-label="展开中间路径"><Ellipsis size="1em" /></summary>
                        <ol class="expanded">
                            {#each items.slice(1, -1) as middle}
                                <li>{#if middle.href}<Link href={middle.href}>{middle.label}</Link>{:else}<span>{middle.label}</span>{/if}</li>
                            {/each}
                        </ol>
                    </details>
                </li>
            {/if}
            <li class:middle={index > 0 && index < items.length - 1}>
                {#if index > 0}<ChevronRight size="1em" aria-hidden="true" />{/if}
                {#if index === items.length - 1}<span aria-current="page">{item.label}</span>
                {:else if item.href}<Link href={item.href}>{item.label}</Link>
                {:else}<span>{item.label}</span>{/if}
            </li>
        {/each}
    </ol>
</nav>

<style>
    .breadcrumb { min-width: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    ol { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-2); list-style: none; margin: 0; padding: 0; }
    li { display: inline-flex; align-items: baseline; gap: var(--space-2); min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
    li :global(svg) { flex-shrink: 0; align-self: center; }
    [aria-current="page"] { color: var(--color-text); }
    .collapsed { display: none; }
    details { min-width: 0; }
    summary { display: flex; width: fit-content; padding: var(--space-1); cursor: pointer; border-radius: var(--radius-sm); }
    summary:hover { background: var(--color-surface-sunken); }
    summary:active { background: var(--color-border); }
    summary:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    .expanded { display: grid; padding: var(--space-2); margin-top: var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    @media (max-width: 639px) { .middle { display: none; } .collapsed { display: inline-flex; } }
</style>