<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children" | "id"> & { commentId: string };
</script>

<script lang="ts">
    import { MessageSquareX } from "@lucide/svelte";
    let { commentId, class: className = "", ...rest }: Props = $props();
</script>

<div {...rest} id={`comment-${commentId}`} class={`deleted-comment ${className}`}>
    <MessageSquareX size="1em" aria-hidden="true" /><span>该评论已删除</span>
</div>

<style>
    .deleted-comment { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding-block: var(--space-4); border-bottom: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: var(--font-size-md); overflow-wrap: anywhere; scroll-margin-top: var(--space-6); }
    .deleted-comment :global(svg) { flex-shrink: 0; }
</style>