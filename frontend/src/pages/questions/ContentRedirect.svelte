<script lang="ts">
    import { resource } from "$lib/api/resource.svelte.js";
    import { navigate } from "$lib/router/router.svelte.js";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ContentState from "./ContentState.svelte";
    import { encode, getContent, locateContent, ownedContentHref, questionHref, urlId } from "./data";
    let { id, kind }: { id: string; kind: "answer" | "comment" } = $props();
    const result = resource(async signal => {
        const content = await getContent(id, signal);
        if (content.status !== "deleted" && !content.isPublic) return { href: ownedContentHref(id) };
        const location = await locateContent(id, kind, signal);
        const base = location.root.kind === "question" ? questionHref(location.root.id) : `/materials/${encode(urlId(location.root.id))}`;
        return { href: `${base}#${kind}-${encode(urlId(id))}` };
    });
    $effect(() => {
        const location = result.data;
        if (!location) return;
        void navigate(location.href, { replace: true });
    });
</script>

<PageLayout title={kind === "answer" ? "定位回答" : "定位评论"} width="prose">
    <ContentState status={result.status === "ready" ? "loading" : result.status} error={result.error} reload={result.reload} />
</PageLayout>