<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    export type FieldControl = { id: string; describedBy: string | undefined; invalid: boolean; required: boolean };
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children" | "id"> & {
        id?: string;
        label: string;
        required?: boolean;
        help?: string;
        error?: string;
        children: Snippet<[FieldControl]>;
    };
</script>

<script lang="ts">
    const generatedId = $props.id();
    let { id = generatedId, label, required = false, help, error, children, class: className = "", ...rest }: Props = $props();
    const describedBy = $derived([help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined);
</script>

<div {...rest} class={`field ${className}`}>
    <label for={id}>{label}{#if required}<span class="required" aria-hidden="true">（必填）</span>{/if}</label>
    {@render children({ id, describedBy, invalid: Boolean(error), required })}
    {#if help}<p id={`${id}-help`} class="help">{help}</p>{/if}
    {#if error}<p id={`${id}-error`} class="error" role="alert">{error}</p>{/if}
</div>

<style>
    /* align-content: start keeps rows at content height when a parent grid stretches the field; otherwise the label row absorbs the extra space. */
    .field { display: grid; align-content: start; gap: var(--space-2); min-width: 0; }
    label { font-size: var(--font-size-md); font-weight: var(--font-weight-bold); }
    .required, .help, .error { font-size: var(--font-size-sm); overflow-wrap: anywhere; }
    .required, .error { color: var(--color-danger); }
    .help { color: var(--color-text-secondary); }
</style>