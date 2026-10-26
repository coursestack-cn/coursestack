<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    type CommonProps = Omit<HTMLAttributes<HTMLElement>, "children" | "onchange"> & { disabled?: boolean };
    export type Props = CommonProps & (
        { mode?: "pages"; page: number; pageCount: number; onchange?: (page: number) => void; hrefFor?: (page: number) => string }
        | { mode: "cursor"; hasPrevious: boolean; hasNext: boolean; onchange: (direction: "previous" | "next") => void }
    );
</script>

<script lang="ts">
    import { ChevronLeft, ChevronRight, Ellipsis } from "@lucide/svelte";
    import Button from "$lib/components/ui/Button.svelte";

    let { class: className = "", disabled = false, ...props }: Props = $props();
    const count = $derived(props.mode === "cursor" ? 1 : Math.max(1, Math.floor(props.pageCount) || 1));
    const current = $derived(props.mode === "cursor" ? 1 : Math.min(count, Math.max(1, Math.floor(props.page) || 1)));
    const pages = $derived.by(() => {
        const selected = new Set([1, count, current - 1, current, current + 1]);
        if (current <= 3) [2, 3, 4].forEach((page) => selected.add(page));
        if (current >= count - 2) [count - 3, count - 2, count - 1].forEach((page) => selected.add(page));
        const sorted = [...selected].filter((page) => page >= 1 && page <= count).sort((a, b) => a - b);
        const result: (number | string)[] = [];
        sorted.forEach((page, index) => {
            const previous = sorted[index - 1];
            if (previous && page - previous === 2) result.push(previous + 1);
            else if (previous && page - previous > 2) result.push(`gap-${page}`);
            result.push(page);
        });
        return result;
    });
    const rest = $derived.by(() => {
        if (props.mode === "cursor") {
            const { mode, hasPrevious, hasNext, onchange, ...attributes } = props;
            return attributes;
        }
        const { mode, page, pageCount, onchange, hrefFor, ...attributes } = props;
        return attributes;
    });

    function change(target: number | "previous" | "next", event: MouseEvent) {
        if (disabled || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        if (props.mode === "cursor") {
            if (target === "previous" && props.hasPrevious || target === "next" && props.hasNext) props.onchange(target as "previous" | "next");
        } else if (typeof target === "number" && target !== current && target >= 1 && target <= count) props.onchange?.(target);
    }

    function href(page: number) { return props.mode === "cursor" ? undefined : props.hrefFor?.(page); }
</script>

<nav {...rest} class={`pagination ${className}`} aria-label={rest["aria-label"] ?? "分页"}>
    <Button size="sm" disabled={disabled || (props.mode === "cursor" ? !props.hasPrevious : current === 1)}
        href={props.mode === "cursor" || current === 1 ? undefined : href(current - 1)}
        onclick={(event) => change(props.mode === "cursor" ? "previous" : current - 1, event)}>
        {#snippet icon()}<ChevronLeft size="1em" />{/snippet}上一页
    </Button>
    {#if props.mode !== "cursor"}
        <span class="pages">
            {#each pages as page (page)}
                {#if typeof page === "number"}
                    <Button size="sm" variant={page === current ? "secondary" : "ghost"} {disabled} href={href(page)}
                        aria-label={`第 ${page} 页`} aria-current={page === current ? "page" : undefined}
                        onclick={(event) => change(page, event)}>{page}</Button>
                {:else}<span class="ellipsis" aria-label="省略页码"><Ellipsis size="1em" /></span>{/if}
            {/each}
        </span>
    {/if}
    <Button size="sm" disabled={disabled || (props.mode === "cursor" ? !props.hasNext : current === count)}
        href={props.mode === "cursor" || current === count ? undefined : href(current + 1)}
        onclick={(event) => change(props.mode === "cursor" ? "next" : current + 1, event)}>
        下一页<ChevronRight size="1em" />
    </Button>
</nav>

<style>
    .pagination, .pages { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); min-width: 0; }
    .pagination { gap: var(--space-2); }
    .pages { max-width: 100%; }
    .pages :global(.cs-button) { min-width: var(--space-8); padding-inline: var(--space-2); }
    .pages :global([aria-current="page"]) { color: var(--color-accent-soft-text); background: var(--color-accent-soft); border-color: var(--color-accent); }
    .ellipsis { display: flex; align-items: center; justify-content: center; width: var(--space-6); color: var(--color-text-secondary); }
</style>