<script lang="ts">
    import type { HighlightRange } from "../../../../shared/search";
    let { text, ranges }: { text: string; ranges: HighlightRange[] } = $props();
    const parts = $derived.by(() => {
        const result: { text: string; match: boolean }[] = [];
        let offset = 0;
        for (const [start, end] of ranges) {
            result.push({ text: text.slice(offset, start), match: false }, { text: text.slice(start, end), match: true });
            offset = end;
        }
        result.push({ text: text.slice(offset), match: false });
        return result;
    });
</script>

{#each parts as part}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}

<style>
    mark { color: inherit; background: var(--color-accent-soft); font-weight: var(--font-weight-bold); }
</style>