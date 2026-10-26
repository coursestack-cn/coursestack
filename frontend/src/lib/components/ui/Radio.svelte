<script module lang="ts">
    import type { HTMLInputAttributes } from "svelte/elements";

    export type Props = Omit<HTMLInputAttributes, "children" | "type" | "value" | "checked"> & {
        label: string;
        value: string;
        group?: string;
        invalid?: boolean;
    };
</script>

<script lang="ts">
    let { label, value, group = $bindable(""), invalid = false, disabled = false,
        onchange, class: className = "", ...rest }: Props = $props();
</script>

<label class={`radio ${className}`} class:disabled>
    <input {...rest} type="radio" {value} checked={group === value} {disabled}
        data-invalid={invalid || undefined} onchange={(event) => { group = value; onchange?.(event); }} />
    <span>{label}</span>
</label>

<style>
    .radio { display: inline-flex; align-items: flex-start; gap: var(--space-2); font-size: var(--font-size-md); cursor: pointer; max-width: 100%; }
    input { appearance: none; flex-shrink: 0; margin: var(--space-1) 0 0; width: var(--space-4); height: var(--space-4); border: 1px solid var(--color-border-strong); border-radius: var(--radius-full); background: var(--color-surface); cursor: inherit; transition: border-color var(--duration-fast) var(--ease-out); }
    input:checked { border: var(--space-1) solid var(--color-accent); }
    input[data-invalid="true"] { border-color: var(--color-danger); }
    input:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    .radio:hover:not(.disabled) input { border-color: var(--color-accent); }
    .radio:active:not(.disabled) input { background: var(--color-accent-soft); }
    span { min-width: 0; overflow-wrap: anywhere; }
    .disabled { opacity: 0.5; cursor: not-allowed; }
</style>