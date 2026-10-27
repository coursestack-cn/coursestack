<script lang="ts">
    import { highlightCode, type HighlightNode } from "./lazy-renderers";
    import "./rich-text.css";

    let { code, language = null }: { code: string; language?: string | null } = $props();
    let highlighted = $state<HighlightNode[] | null>(null);

    $effect(() => {
        const source = code;
        const grammar = language;
        let active = true;
        highlighted = null;
        void highlightCode(source, grammar).then((result) => {
            if (active) highlighted = result;
        }).catch(() => {
            // A failed optional language chunk leaves the full code readable.
        });
        return () => { active = false; };
    });
</script>

{#snippet tokens(nodes: HighlightNode[])}
    {#each nodes as node}
        {#if node.type === "text"}{node.value}{:else}<span class={node.properties.className?.join(" ")}>{@render tokens(node.children)}</span>{/if}
    {/each}
{/snippet}

<pre class="rich-code"><code class={language ? `language-${language}` : undefined}>{#if highlighted}{@render tokens(highlighted)}{:else}{code}{/if}</code></pre>