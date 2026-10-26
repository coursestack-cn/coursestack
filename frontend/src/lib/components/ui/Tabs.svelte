<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    export type TabItem = { value: string; label: string; count?: number; disabled?: boolean };
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children" | "onchange"> & {
        items: TabItem[];
        value?: string;
        label?: string;
        children?: Snippet<[string]>;
        onchange?: (value: string) => void;
    };
</script>

<script lang="ts">
    const id = $props.id();
    let { items, value = $bindable(""), label = "内容选项卡", children, onchange, class: className = "", ...rest }: Props = $props();
    let list: HTMLDivElement;
    const enabled = $derived(items.filter((item) => !item.disabled));
    const selected = $derived(enabled.some((item) => item.value === value) ? value : enabled[0]?.value);

    // Keep the bound value in step with the tab that is actually shown.
    $effect(() => { if (selected !== undefined && value !== selected) value = selected; });

    function select(next: string) { value = next; onchange?.(next); }
    function move(event: KeyboardEvent, current: string) {
        let index = enabled.findIndex((item) => item.value === current);
        if (event.key === "ArrowRight") index++;
        else if (event.key === "ArrowLeft") index--;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = enabled.length - 1;
        else return;
        if (!enabled.length) return;
        event.preventDefault();
        index = (index + enabled.length) % enabled.length;
        select(enabled[index]!.value);
        list.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")[index]?.focus();
    }
</script>

<div {...rest} class={`tabs ${className}`}>
    <div class="tab-list" bind:this={list} role="tablist" aria-label={label}>
        {#each items as item, index (item.value)}
            <button type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`}
                aria-selected={selected === item.value} tabindex={selected === item.value ? 0 : -1} disabled={item.disabled}
                onclick={() => select(item.value)} onkeydown={(event) => move(event, item.value)}>
                {item.label}{#if item.count !== undefined}<span class="count">{item.count}</span>{/if}
            </button>
        {/each}
    </div>
    {#each items as item, index (item.value)}
        <div class="panel" role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`}
            tabindex="0" hidden={selected !== item.value}>
            {#if selected === item.value}{@render children?.(item.value)}{/if}
        </div>
    {/each}
</div>

<style>
    .tabs { min-width: 0; }
    .tab-list { display: flex; flex-wrap: wrap; gap: var(--space-1); border-bottom: 1px solid var(--color-border); }
    button { display: inline-flex; align-items: center; gap: var(--space-2); max-width: 100%; padding: var(--space-3) var(--space-4); border: 0; border-bottom: 2px solid var(--color-border); background: none; color: var(--color-text-secondary); font-size: var(--font-size-md); cursor: pointer; overflow-wrap: anywhere; transition: background var(--duration-fast) var(--ease-out); }
    button[aria-selected="true"] { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: var(--font-weight-bold); }
    button:hover:not(:disabled) { background: var(--color-surface-sunken); color: var(--color-text); }
    button:active:not(:disabled) { background: var(--color-accent-soft); }
    button:focus-visible, .panel:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .count { padding-inline: var(--space-1); border-radius: var(--radius-sm); background: var(--color-surface-sunken); color: var(--color-text-secondary); font-size: var(--font-size-xs); }
    .panel { padding-block: var(--space-4); overflow-wrap: anywhere; }
</style>