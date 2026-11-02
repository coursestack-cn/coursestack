<script lang="ts">
    import { type PageProps } from "$lib/router/types";
    import MaterialFormPage from "./MaterialFormPage.svelte";
    let { params }: PageProps = $props();
</script>

<MaterialFormPage materialId={params.materialId!} mode="version" />