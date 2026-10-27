<script lang="ts">
    import { RICH_TEXT_LIMITS } from "./index";
    import { renderMath } from "./lazy-renderers";
    import "./rich-text.css";

    let { latex, display = false }: { latex: string; display?: boolean } = $props();
    let markup = $state<string | null>(null);
    let unavailable = $state(false);

    $effect(() => {
        const source = latex;
        const mode = display;
        let active = true;
        markup = null;
        unavailable = false;
        if (Array.from(source).length > RICH_TEXT_LIMITS.maxLatexChars) {
            unavailable = true;
            return;
        }
        void renderMath(source, mode).then((result) => {
            if (active) markup = result;
        }).catch(() => {
            if (active) unavailable = true;
        });
        return () => { active = false; };
    });
</script>

<svelte:element this={display ? "div" : "span"} class:rich-math-block={display} class="rich-math">
    {#if markup !== null}
        {@html markup}
    {:else if unavailable}
        <span class="rich-content-unavailable">公式暂时无法显示</span>
    {:else}
        <span class="rich-math-source" aria-label="公式">{latex}</span>
    {/if}
</svelte:element>