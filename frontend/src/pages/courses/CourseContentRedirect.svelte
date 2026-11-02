<script lang="ts">
    import { navigate, router } from "$lib/router/router.svelte";
    import { encode } from "../questions/data";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    let { courseCode, kind }: { courseCode: string; kind: "question" | "material" } = $props();
    $effect(() => {
        const query = new URLSearchParams(router.query);
        query.set("kind", kind);
        if (kind === "material") { query.delete("state"); if (query.get("sort") === "score") query.delete("sort"); }
        void navigate(`/courses/${encode(courseCode)}?${query}${router.hash}`, { replace: true });
    });
</script>

<ResourceState status="loading" />