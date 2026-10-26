<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type SegmentOption = { value: string; label: string; disabled?: boolean };
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children" | "onchange"> & {
        options: SegmentOption[];
        value?: string;
        label?: string;
        disabled?: boolean;
        onchange?: (value: string) => void;
    };
</script>

<script lang="ts">
    let { options, value = $bindable(""), label = "切换选项", disabled = false,
        onchange, class: className = "", ...rest }: Props = $props();
    let root: HTMLDivElement;
    const enabled = $derived(options.filter((option) => !option.disabled && !disabled));
    const tabValue = $derived(enabled.some((option) => option.value === value) ? value : enabled[0]?.value);

    // Without a valid initial value, check the first enabled option so the group is never unchecked.
    $effect(() => {
        if (!options.some((option) => option.value === value) && enabled[0]) value = enabled[0].value;
    });

    function select(next: string) {
        value = next;
        onchange?.(next);
    }

    function move(event: KeyboardEvent, current: string) {
        let index = enabled.findIndex((option) => option.value === current);
        if (event.key === "ArrowRight" || event.key === "ArrowDown") index++;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") index--;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = enabled.length - 1;
        else return;
        if (!enabled.length) return;
        event.preventDefault();
        const next = enabled[(index + enabled.length) % enabled.length]!;
        select(next.value);
        root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")[(index + enabled.length) % enabled.length]?.focus();
    }
</script>

<div {...rest} bind:this={root} class={`segmented ${className}`} role="radiogroup" aria-label={rest["aria-label"] ?? label}>
    {#each options as option (option.value)}
        <button type="button" role="radio" aria-checked={value === option.value}
            disabled={disabled || option.disabled} tabindex={tabValue === option.value ? 0 : -1}
            onclick={() => select(option.value)} onkeydown={(event) => move(event, option.value)}>{option.label}</button>
    {/each}
</div>

<style>
    .segmented { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-1); max-width: 100%; min-width: 0; background: var(--color-surface-sunken); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    button { flex: 1 1 auto; min-width: 0; padding: var(--space-1) var(--space-3); border: 1px solid var(--color-surface-sunken); border-radius: var(--radius-sm); background: none; color: var(--color-text-secondary); font-size: var(--font-size-md); cursor: pointer; overflow-wrap: anywhere; transition: background var(--duration-fast) var(--ease-out); }
    button[aria-checked="true"] { background: var(--color-surface); border-color: var(--color-border-strong); color: var(--color-accent); font-weight: var(--font-weight-bold); }
    button:hover:not(:disabled) { background: var(--color-surface); color: var(--color-text); }
    button:active:not(:disabled) { background: var(--color-accent-soft); }
    button:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>