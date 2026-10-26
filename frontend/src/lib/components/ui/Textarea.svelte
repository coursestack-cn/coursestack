<script module lang="ts">
    import type { HTMLTextareaAttributes } from "svelte/elements";

    export type Props = Omit<HTMLTextareaAttributes, "children" | "value"> & {
        value?: string;
        invalid?: boolean;
        autoResize?: boolean;
    };
</script>

<script lang="ts">
    let { value = $bindable(""), rows = 4, invalid = false, autoResize = false, class: className = "", ...rest }: Props = $props();
    let element: HTMLTextAreaElement;

    function resize() {
        if (!element || !autoResize || element.clientWidth === 0) return;
        element.style.height = "auto";
        const style = getComputedStyle(element);
        element.style.height = `${element.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
    }

    $effect(() => {
        value;
        rows;
        if (!autoResize) {
            element?.style.removeProperty("height");
            return;
        }
        resize();
        const observer = new ResizeObserver(() => {
            if (element.clientWidth !== previousWidth) {
                previousWidth = element.clientWidth;
                resize();
            }
        });
        let previousWidth = element.clientWidth;
        observer.observe(element);
        return () => observer.disconnect();
    });
</script>

<textarea {...rest} bind:this={element} bind:value {rows} class={`textarea ${className}`}
    class:auto-resize={autoResize} aria-invalid={invalid || rest["aria-invalid"]}></textarea>

<style>
    /* Whole-pixel line-height: a fractional rows × line-height can overflow by a subpixel on high-DPI screens and show an empty scrollbar. */
    .textarea { display: block; width: 100%; min-width: 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font-size: var(--font-size-md); line-height: round(calc(var(--line-height-base) * 1em), 1px); resize: vertical; transition: border-color var(--duration-fast) var(--ease-out); }
    .textarea:hover:not(:disabled) { border-color: var(--color-text-secondary); }
    .textarea:active:not(:disabled) { border-color: var(--color-accent); }
    .textarea:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
    .textarea[aria-invalid="true"] { border-color: var(--color-danger); }
    .textarea:disabled { opacity: 0.5; cursor: not-allowed; background: var(--color-surface-sunken); }
    .textarea::placeholder { color: var(--color-text-muted); }
    .textarea.auto-resize { resize: none; overflow-y: hidden; }
</style>