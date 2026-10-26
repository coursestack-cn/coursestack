<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    import type { ToastAction, ToastTone } from "$lib/components/ui/toast.svelte.js";

    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children" | "onclose"> & {
        tone?: ToastTone;
        message: string;
        action?: ToastAction;
        onclose: () => void;
    };
</script>

<script lang="ts">
    import { CircleCheck, CircleAlert, Info, X } from "@lucide/svelte";
    import Button from "$lib/components/ui/Button.svelte";

    let { tone = "info", message, action, onclose, class: className = "",
        onmouseenter, onmouseleave, onfocusin, onfocusout, ...rest }: Props = $props();
    const Icon = $derived(tone === "error" ? CircleAlert : tone === "success" ? CircleCheck : Info);
    let hovered = false;
    let focused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remaining = 4000;
    let started = 0;

    function pause() {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        remaining = Math.max(0, remaining - (performance.now() - started));
    }
    function resume() {
        if (tone === "error" || hovered || focused || timer !== undefined) return;
        started = performance.now();
        timer = setTimeout(() => { timer = undefined; onclose(); }, remaining);
    }

    $effect(() => {
        tone;
        message;
        remaining = 4000;
        resume();
        return () => { clearTimeout(timer); timer = undefined; };
    });
</script>

<div {...rest} class={`toast ${tone} ${className}`} role={tone === "error" ? "alert" : "status"}
    aria-live={tone === "error" ? "assertive" : "polite"} aria-atomic="true"
    onmouseenter={(event) => { hovered = true; pause(); onmouseenter?.(event); }}
    onmouseleave={(event) => { hovered = false; resume(); onmouseleave?.(event); }}
    onfocusin={(event) => { focused = true; pause(); onfocusin?.(event); }}
    onfocusout={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) { focused = false; resume(); }
        onfocusout?.(event);
    }}>
    <span class="icon" aria-hidden="true"><Icon size="1em" /></span>
    <div class="content"><p>{message}</p>
        {#if action}<Button size="sm" variant="ghost" onclick={() => { action?.onclick(); onclose(); }}>{action.label}</Button>{/if}
    </div>
    <Button iconOnly size="sm" variant="ghost" aria-label="关闭提示" onclick={onclose}><X size="1em" /></Button>
</div>

<style>
    .toast { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-popover); font-size: var(--font-size-md); }
    .icon { display: flex; flex-shrink: 0; padding-top: var(--space-2); color: var(--color-accent); }
    .success .icon { color: var(--color-success); }
    .error .icon { color: var(--color-danger); }
    .content { flex: 1; min-width: 0; display: grid; justify-items: start; gap: var(--space-2); padding-top: var(--space-1); }
    p { margin: 0; overflow-wrap: anywhere; }
</style>