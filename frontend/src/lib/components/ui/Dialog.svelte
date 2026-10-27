<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLDialogAttributes } from "svelte/elements";

    export type Props = Omit<HTMLDialogAttributes, "children" | "open" | "title"> & {
        open?: boolean;
        title: string;
        description?: string;
        closeOnBackdrop?: boolean;
        dismissible?: boolean;
        children?: Snippet;
        actions?: Snippet;
    };
</script>

<script lang="ts">
    import { untrack } from "svelte";
    import { X } from "@lucide/svelte";
    import Button from "$lib/components/ui/Button.svelte";

    const id = $props.id();
    let { open = $bindable(false), title, description, closeOnBackdrop = false, dismissible = true,
        children, actions, oncancel, onclose, onclick, onpointerdown, class: className = "", ...rest }: Props = $props();
    let element: HTMLDialogElement;
    let previousFocus: HTMLElement | null = null;
    let startedOnBackdrop = false;
    let destroyed = false;

    function restoreFocus() {
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        previousFocus = null;
    }
    function outside(event: MouseEvent) {
        const rect = element.getBoundingClientRect();
        return event.target === element && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    }

    $effect(() => {
        if (!element) return;
        if (open && !element.open) {
            previousFocus = untrack(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
            element.showModal();
        } else if (!open && element.open) {
            element.close();
            restoreFocus();
        }
    });

    // close() fires its event in a later task, after the binding is cleared and the owner may be gone.
    $effect(() => {
        const dialog = element;
        return () => {
            destroyed = true;
            if (dialog?.open) { dialog.close(); restoreFocus(); }
        };
    });
</script>

<dialog {...rest} bind:this={element} class={`dialog ${className}`} aria-labelledby={`${id}-title`}
    aria-describedby={description ? `${id}-description` : rest["aria-describedby"]}
    oncancel={(event) => {
        oncancel?.(event);
        const prevented = event.defaultPrevented;
        event.preventDefault();
        if (!prevented && dismissible) open = false;
    }} onclose={(event) => {
        if (destroyed) return;
        if (!element.open) { open = false; restoreFocus(); }
        onclose?.(event);
    }} onpointerdown={(event) => { startedOnBackdrop = outside(event); onpointerdown?.(event); }}
    onclick={(event) => {
        onclick?.(event);
        if (!event.defaultPrevented && dismissible && closeOnBackdrop && startedOnBackdrop && outside(event)) open = false;
        startedOnBackdrop = false;
    }}>
    <header><h2 id={`${id}-title`}>{title}</h2>
        <Button iconOnly variant="ghost" size="sm" aria-label="关闭对话框" disabled={!dismissible} onclick={() => { open = false; }}><X size="1em" /></Button>
    </header>
    <div class="body">
        {#if description}<p id={`${id}-description`} class="description">{description}</p>{/if}
        {@render children?.()}
    </div>
    {#if actions}<footer>{@render actions()}</footer>{/if}
</dialog>

<style>
    .dialog { width: min(calc(var(--space-12) * 12), calc(100% - var(--space-8))); max-width: var(--width-prose); max-height: calc(100% - var(--space-8)); margin: auto; padding: 0; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-popover); z-index: var(--z-dialog); }
    .dialog::backdrop { background: var(--color-overlay); }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); padding: var(--space-6) var(--space-6) var(--space-4); }
    h2 { margin: 0; min-width: 0; font-size: var(--font-size-xl); overflow-wrap: anywhere; }
    .body { display: grid; gap: var(--space-4); padding: 0 var(--space-6) var(--space-6); overflow-wrap: anywhere; }
    .description { color: var(--color-text-secondary); font-size: var(--font-size-md); }
    footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); padding: var(--space-4) var(--space-6); border-top: 1px solid var(--color-border); }
    @media (max-width: 639px) { header { padding: var(--space-4); } .body { padding: 0 var(--space-4) var(--space-4); } footer { padding: var(--space-4); } }
</style>