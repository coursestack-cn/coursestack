<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAnchorAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAnchorAttributes, "children"> & { children?: Snippet };
</script>

<script lang="ts">
    let { children, class: className = "", ...rest }: Props = $props();
</script>

<a {...rest} class={className}>{@render children?.()}</a>