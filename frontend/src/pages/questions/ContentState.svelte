<script lang="ts">
    import type { Snippet } from "svelte";
    import type { ResourceStatus } from "$lib/api/resource.svelte";
    import type { ApiError } from "$lib/api/client";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    let { status, error, refreshing = false, reload, children }: {
        status: ResourceStatus; error?: ApiError | null; refreshing?: boolean; reload?: () => void; children?: Snippet;
    } = $props();
</script>

{#if status === "error" && error?.code === "CONTENT_UNAVAILABLE"}
    <StateBlock kind="unavailable" title="内容不可用" description="该内容不存在，或已被下架、删除。" />
{:else}
    <ResourceState {status} {error} {refreshing} {reload}>{@render children?.()}</ResourceState>
{/if}