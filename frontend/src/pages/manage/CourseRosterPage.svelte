<script lang="ts">
    import PagePlaceholder from "$lib/components/shell/PagePlaceholder.svelte";
    import type { PageProps } from "$lib/router/types";

    let { params }: PageProps = $props();
</script>

<PagePlaceholder {params} />