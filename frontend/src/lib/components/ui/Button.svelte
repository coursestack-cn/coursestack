<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes, HTMLAnchorAttributes } from "svelte/elements";

    type BaseProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
        variant?: "primary" | "secondary" | "ghost" | "danger";
        size?: "sm" | "md";
        loading?: boolean;
        disabled?: boolean;
        href?: string;
        target?: HTMLAnchorAttributes["target"];
        rel?: string;
        download?: HTMLAnchorAttributes["download"];
        type?: "button" | "submit" | "reset";
        form?: string;
        name?: string;
        value?: string;
        icon?: Snippet;
        children?: Snippet;
    };
    export type Props = BaseProps & (
        { iconOnly: true; "aria-label": string } | { iconOnly?: false }
    );
</script>

<script lang="ts">
    import Link from "$lib/components/ui/Link.svelte";
    import Spinner from "$lib/components/ui/Spinner.svelte";

    let {
        variant = "secondary", size = "md", loading = false, disabled = false,
        href, target, rel, download, type = "button", form, name, value,
        icon, iconOnly = false, children, class: className = "", onclick, ...rest
    }: Props = $props();
    const blocked = $derived(disabled || loading);
    const classes = $derived(`cs-button ${variant} ${size} ${iconOnly ? "icon-only" : ""} ${className}`);

    function click(event: MouseEvent & { currentTarget: EventTarget & HTMLElement }) {
        if (blocked) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        onclick?.(event);
    }
</script>

{#snippet content()}
    <span class="cs-button-content" class:concealed={loading}>
        {#if icon}<span class="cs-button-icon" aria-hidden="true">{@render icon()}</span>{/if}
        {@render children?.()}
    </span>
    {#if loading}<span class="cs-button-loader" aria-hidden="true"><Spinner /></span>{/if}
{/snippet}

{#if href !== undefined}
    <Link {...rest} class={classes} href={blocked ? undefined : href} {target} {rel} {download}
        role="link" aria-disabled={blocked || undefined} aria-busy={loading || undefined}
        tabindex={blocked ? -1 : rest.tabindex} onclick={click}>
        {@render content()}
    </Link>
{:else}
    <button {...rest} class={classes} {type} {form} {name} {value} disabled={blocked}
        aria-busy={loading || undefined} onclick={click}>
        {@render content()}
    </button>
{/if}

<style>
    :global(.cs-button) { position: relative; display: inline-flex; align-items: center; justify-content: center; max-width: 100%; min-height: var(--space-10); padding: var(--space-2) var(--space-4); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font: inherit; font-size: var(--font-size-md); font-weight: var(--font-weight-bold); line-height: var(--line-height-tight); text-align: center; text-decoration: none; cursor: pointer; overflow-wrap: anywhere; transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
    :global(.cs-button.sm) { min-height: var(--space-8); padding: var(--space-1) var(--space-3); font-size: var(--font-size-sm); }
    :global(.cs-button.primary) { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
    :global(.cs-button.ghost) { background: none; border-color: transparent; }
    :global(.cs-button.danger) { background: var(--color-danger); border-color: var(--color-danger); color: var(--color-on-danger); }
    :global(.cs-button:hover:not(:disabled):not([aria-disabled="true"])) { background: var(--color-surface-sunken); color: var(--color-text); border-color: var(--color-border-strong); text-decoration: none; }
    :global(.cs-button.primary:hover:not(:disabled):not([aria-disabled="true"])) { background: var(--color-accent-hover); color: var(--color-on-accent); border-color: var(--color-accent-hover); }
    :global(.cs-button.danger:hover:not(:disabled):not([aria-disabled="true"])) { background: var(--color-danger-soft-text); color: var(--color-danger-soft); border-color: var(--color-danger-soft-text); }
    :global(.cs-button:active:not(:disabled):not([aria-disabled="true"])) { transform: translateY(1px); }
    :global(.cs-button:focus-visible) { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    :global(.cs-button:disabled), :global(.cs-button[aria-disabled="true"]) { opacity: 0.5; cursor: not-allowed; }
    :global(.cs-button[aria-busy="true"]) { opacity: 1; cursor: wait; }
    :global(.cs-button.icon-only) { width: var(--space-10); padding: var(--space-2); flex-shrink: 0; }
    :global(.cs-button.icon-only.sm) { width: var(--space-8); }
    .cs-button-content { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-width: 0; }
    .cs-button-content.concealed { opacity: 0; }
    .cs-button-icon { display: inline-flex; flex-shrink: 0; }
    .cs-button-icon :global(svg) { width: 1em; height: 1em; }
    .cs-button-loader { position: absolute; display: flex; inset: 0; align-items: center; justify-content: center; }
</style>