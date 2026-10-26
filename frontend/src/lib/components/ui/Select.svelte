<script module lang="ts">
    import type { HTMLSelectAttributes } from "svelte/elements";

    export type SelectOption = { value: string; label: string; disabled?: boolean };
    export type Props = Omit<HTMLSelectAttributes, "children" | "value" | "multiple"> & {
        options: SelectOption[];
        value?: string;
        invalid?: boolean;
    };
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import { ChevronDown } from "@lucide/svelte";

    let { options, value = $bindable(""), invalid = false, class: className = "", ...rest }: Props = $props();

    let customizable = $state(false);

    onMount(() => {
        customizable = CSS.supports("appearance", "base-select");
    });
</script>

<div class={`select ${className}`}>
    <select {...rest} bind:value aria-invalid={invalid || rest["aria-invalid"]}>
        {#if customizable}
            <button type="button"><selectedcontent></selectedcontent></button>
        {/if}
        {#each options as option (option.value)}
            <option value={option.value} disabled={option.disabled}>{option.label}</option>
        {/each}
    </select>
    <span aria-hidden="true"><ChevronDown size="1em" /></span>
</div>

<style>
    /* Select and icon share one grid cell, so the icon stays centred on the control even when a parent stretches the wrapper. */
    .select { display: grid; align-content: start; width: 100%; min-width: 0; font-size: var(--font-size-md); }
    select, span { grid-area: 1 / 1; }
    select { appearance: none; width: 100%; min-width: 0; min-height: var(--space-10); padding: var(--space-2) var(--space-10) var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); text-overflow: ellipsis; transition: border-color var(--duration-fast) var(--ease-out); }
    select:hover:not(:disabled) { border-color: var(--color-text-secondary); }
    select:active:not(:disabled) { border-color: var(--color-accent); }
    select:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    select[aria-invalid="true"] { border-color: var(--color-danger); }
    select:disabled { opacity: 0.5; cursor: not-allowed; background: var(--color-surface-sunken); }
    /* Progressive enhancement: style the open list where customizable select is supported; others keep the native list. */
    @supports (appearance: base-select) {
        select, select::picker(select) { appearance: base-select; }
        select > :global(button) { display: flex; width: 100%; min-width: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; }
        select :global(selectedcontent) { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        select::picker-icon { display: none; }
        /* The list defaults to max-content width; cap it to the viewport so long options wrap instead of running off screen. */
        select::picker(select) { max-inline-size: min(calc(var(--space-12) * 10), calc(100vw - var(--space-8))); margin-block: var(--space-1); padding: var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-popover); }
        option { padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); font-size: var(--font-size-md); white-space: normal; overflow-wrap: anywhere; cursor: pointer; }
        option:hover:not(:disabled), option:focus-visible { background: var(--color-surface-sunken); outline: none; }
        option:checked { color: var(--color-accent); font-weight: var(--font-weight-bold); }
        /* Replace the browser's text "✓" with Lucide's check shape, used as a mask and painted with currentColor. */
        option::checkmark { content: ""; flex-shrink: 0; width: 1em; height: 1em; background-color: currentColor; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / contain no-repeat; }
        option:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    span { display: flex; justify-self: end; align-self: center; margin-inline-end: var(--space-3); pointer-events: none; color: var(--color-text-secondary); }
</style>