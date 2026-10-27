<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";

    export type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
        kind: "accepted" | "solved" | "unsolved";
    };
</script>

<script lang="ts">
    import { CircleCheck, CircleHelp, Check } from "@lucide/svelte";
    import Badge from "../ui/Badge.svelte";

    let { kind, ...rest }: Props = $props();
</script>

<Badge {...rest} tone={kind === "unsolved" ? "neutral" : "success"}>
    {#snippet icon()}
        {#if kind === "accepted"}<Check size="1em" />{:else if kind === "solved"}<CircleCheck size="1em" />{:else}<CircleHelp size="1em" />{/if}
    {/snippet}
    {kind === "accepted" ? "已采纳" : kind === "solved" ? "已解决" : "未解决"}
</Badge>