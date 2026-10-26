<script module lang="ts">
    import type { HTMLInputAttributes } from "svelte/elements";

    export type Props = Omit<HTMLInputAttributes, "children" | "type"> & {
        label: string;
        invalid?: boolean;
        indeterminate?: boolean;
    };
</script>

<script lang="ts">
    import { Check, Minus } from "@lucide/svelte";

    let { label, checked = $bindable(false), indeterminate = $bindable(false), invalid = false,
        disabled = false, class: className = "", ...rest }: Props = $props();
</script>

<label class={`checkbox ${className}`} class:disabled>
    <span class="control">
        <input {...rest} type="checkbox" bind:checked bind:indeterminate {disabled} aria-invalid={invalid || rest["aria-invalid"]} />
        <span class="mark" aria-hidden="true">{#if indeterminate}<Minus size="1em" />{:else if checked}<Check size="1em" />{/if}</span>
    </span>
    <span class="label">{label}</span>
</label>

<style>
    .checkbox { display: inline-flex; align-items: flex-start; gap: var(--space-2); font-size: var(--font-size-md); cursor: pointer; max-width: 100%; }
    .control { position: relative; display: flex; margin-top: var(--space-1); flex-shrink: 0; }
    input { appearance: none; margin: 0; width: var(--space-4); height: var(--space-4); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface); cursor: inherit; transition: background var(--duration-fast) var(--ease-out); }
    input:checked, input:indeterminate { background: var(--color-accent); border-color: var(--color-accent); }
    input[aria-invalid="true"] { border-color: var(--color-danger); }
    input:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    .checkbox:hover:not(.disabled) input { border-color: var(--color-accent); }
    .checkbox:active:not(.disabled) input { background: var(--color-accent-soft); }
    .mark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--color-on-accent); pointer-events: none; }
    .label { min-width: 0; overflow-wrap: anywhere; }
    .disabled { opacity: 0.5; cursor: not-allowed; }
</style>