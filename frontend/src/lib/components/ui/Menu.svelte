<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    export type MenuItem = { type: "separator" } | {
        type?: "item";
        label: string;
        icon?: Snippet;
        onselect?: () => void;
        href?: string;
        danger?: boolean;
        disabled?: boolean;
        checked?: boolean;
        current?: boolean;
    };
    export type MenuTriggerProps = {
        id: string;
        "aria-haspopup": "menu";
        "aria-expanded": boolean;
        "aria-controls": string;
        onclick: (event: MouseEvent) => void;
        onkeydown: (event: KeyboardEvent) => void;
    };
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        items: MenuItem[];
        trigger: Snippet<[MenuTriggerProps]>;
    };
</script>

<script lang="ts">
    import { tick } from "svelte";
    import { Check } from "@lucide/svelte";
    import Link from "$lib/components/ui/Link.svelte";

    const id = $props.id();
    let { items, trigger, class: className = "", ...rest }: Props = $props();
    let root: HTMLDivElement;
    let panel: HTMLDivElement;
    let anchor: HTMLElement | undefined;
    let open = $state(false);
    let left = $state(0);
    let top = $state(0);
    let availableHeight = $state(0);

    function controls() { return Array.from(panel.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')); }

    function position() {
        if (!anchor || !panel) return;
        const rect = anchor.getBoundingClientRect();
        const margin = parseFloat(getComputedStyle(panel).getPropertyValue("--space-2"));
        const viewport = window.visualViewport;
        const width = viewport?.width ?? window.innerWidth;
        const height = viewport?.height ?? window.innerHeight;
        const offsetX = viewport?.offsetLeft ?? 0;
        const offsetY = viewport?.offsetTop ?? 0;
        const menuWidth = panel.getBoundingClientRect().width;
        const rightEdge = offsetX + width - margin;
        const alignedLeft = rect.left + menuWidth > rightEdge ? rect.right - menuWidth : rect.left;
        left = Math.max(offsetX + margin, Math.min(alignedLeft, rightEdge - menuWidth));
        const desiredTop = rect.bottom + margin;
        const naturalHeight = panel.scrollHeight;
        top = desiredTop + Math.min(naturalHeight, height / 2) <= offsetY + height - margin
            ? desiredTop : Math.max(offsetY + margin, rect.top - Math.min(naturalHeight, height - margin * 2) - margin);
        availableHeight = Math.max(0, offsetY + height - top - margin);
    }

    function close() {
        if (!open) return;
        open = false;
        panel.hidePopover();
        anchor?.focus({ preventScroll: true });
    }

    async function show(event: Event, last = false) {
        anchor = event.currentTarget as HTMLElement;
        open = true;
        panel.showPopover();
        position();
        await tick();
        if (!open) return;
        const available = controls();
        (last ? available.at(-1) : available[0])?.focus({ preventScroll: true });
        if (!available.length) panel.focus();
    }

    function keydown(event: KeyboardEvent) {
        if (event.key === "Escape" || event.key === "Tab") {
            if (event.key === "Escape") event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        const available = controls();
        let index = available.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown") index++;
        else if (event.key === "ArrowUp") index--;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = available.length - 1;
        else return;
        event.preventDefault();
        available[(index + available.length) % available.length]?.focus();
    }

    $effect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => { if (!event.composedPath().includes(root)) close(); };
        window.addEventListener("pointerdown", outside);
        window.addEventListener("resize", position);
        window.addEventListener("scroll", position, true);
        window.visualViewport?.addEventListener("resize", position);
        return () => {
            window.removeEventListener("pointerdown", outside);
            window.removeEventListener("resize", position);
            window.removeEventListener("scroll", position, true);
            window.visualViewport?.removeEventListener("resize", position);
        };
    });
</script>

<div {...rest} class={`menu ${className}`} bind:this={root}>
    {@render trigger({
        id: `${id}-trigger`, "aria-haspopup": "menu", "aria-expanded": open, "aria-controls": `${id}-menu`,
        onclick: (event) => { if (open) close(); else void show(event); },
        onkeydown: (event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                void show(event, event.key === "ArrowUp");
            }
        }
    })}
    <div bind:this={panel} id={`${id}-menu`} class="panel" popover="manual" role="menu" tabindex="-1"
        aria-labelledby={`${id}-trigger`} style:left={`${left}px`} style:top={`${top}px`}
        style:max-height={availableHeight ? `${availableHeight}px` : undefined} onkeydown={keydown}>
        {#each items as item}
            {#if item.type === "separator"}<div class="separator" role="separator"></div>
            {:else}
                {#snippet content()}
                    {#if item.checked !== undefined}
                        <span class="icon check-slot" aria-hidden="true">{#if item.checked}<Check size="1em" />{/if}</span>
                    {:else if item.icon}<span class="icon" aria-hidden="true">{@render item.icon()}</span>{/if}
                    <span>{item.label}</span>
                {/snippet}
                {#if item.href !== undefined}
                    <Link class={`cs-menu-item ${item.danger ? "danger" : ""}`} role={item.checked === undefined ? "menuitem" : "menuitemradio"} tabindex={-1}
                        aria-checked={item.checked} aria-current={item.current ? "page" : undefined}
                        href={item.disabled ? undefined : item.href} aria-disabled={item.disabled || undefined}
                        onclick={(event) => {
                            if (item.disabled) { event.preventDefault(); return; }
                            close();
                            item.onselect?.();
                        }}>{@render content()}</Link>
                {:else}
                    <button type="button" class={`cs-menu-item ${item.danger ? "danger" : ""}`} role={item.checked === undefined ? "menuitem" : "menuitemradio"} tabindex="-1"
                        aria-checked={item.checked} aria-current={item.current ? "page" : undefined}
                        disabled={item.disabled} aria-disabled={item.disabled || undefined}
                        onclick={() => { close(); item.onselect?.(); }}>{@render content()}</button>
                {/if}
            {/if}
        {/each}
    </div>
</div>

<style>
    .menu { display: inline-block; max-width: 100%; }
    .panel { position: fixed; inset: auto; margin: 0; width: max-content; min-width: min(calc(var(--space-12) * 4), calc(100vw - var(--space-4))); max-width: min(calc(var(--space-12) * 7), calc(100vw - var(--space-4))); padding: var(--space-1); overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-popover); background: var(--color-surface); color: var(--color-text); z-index: var(--z-dropdown); }
    :global(.cs-menu-item) { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-md); background: none; color: var(--color-text); font: inherit; font-size: var(--font-size-md); text-align: start; text-decoration: none; cursor: pointer; overflow-wrap: anywhere; }
    :global(.cs-menu-item.danger) { color: var(--color-danger); }
    :global(.cs-menu-item:hover:not([aria-disabled="true"])) { background: var(--color-surface-sunken); color: var(--color-text); text-decoration: none; }
    :global(.cs-menu-item.danger:hover:not([aria-disabled="true"])) { background: var(--color-danger-soft); color: var(--color-danger-soft-text); }
    :global(.cs-menu-item:active:not([aria-disabled="true"])) { background: var(--color-accent-soft); }
    :global(.cs-menu-item:focus-visible) { outline: 2px solid var(--color-focus-ring); outline-offset: -2px; background: var(--color-surface-sunken); }
    :global(.cs-menu-item[aria-current="page"]:not([aria-disabled="true"])) { color: var(--color-accent-soft-text); background: var(--color-accent-soft); }
    :global(.cs-menu-item[aria-disabled="true"]) { opacity: 0.5; cursor: not-allowed; }
    .icon { display: inline-flex; flex-shrink: 0; }
    .icon :global(svg) { width: 1em; height: 1em; }
    .check-slot { width: 1em; height: 1em; }
    .separator { height: 1px; background: var(--color-border); margin: var(--space-1); }
</style>