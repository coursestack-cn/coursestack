<script lang="ts">
    import { onDestroy } from "svelte";
    import { Bookmark } from "@lucide/svelte";
    import { resource } from "$lib/api/resource.svelte";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { favorites, favoriteKey, favoriteStatus, setFavorite, type FavoriteType } from "$lib/favorites.svelte";
    import { session } from "$lib/session.svelte";
    import { navigate, router } from "$lib/router/router.svelte";
    import { loginHref } from "$lib/router/urls";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import Button from "$lib/components/ui/Button.svelte";

    let { type, id, available = true, removeLabel = false }: { type: FavoriteType; id: string; available?: boolean; removeLabel?: boolean } = $props();
    const state = resource(signal => { favorites.revision; return favoriteStatus({ type, id }, signal); });
    const selected = $derived(state.data?.viewer === session.user?.id && state.data?.id === id && state.data?.type === type && Boolean(state.data?.favorited));
    const pending = $derived(Boolean(favorites.pending[favoriteKey({ type, id })]));
    const controller = new AbortController();
    onDestroy(() => controller.abort());
    async function toggle() {
        if (!session.user) { await navigate(loginHref(router.href)); return; }
        if (state.error) { state.reload(); return; }
        try { await setFavorite({ type, id }, !selected, controller.signal); }
        catch (error) { if (!controller.signal.aborted && !isAborted(error)) toast.error(userMessage(error)); }
    }
</script>

<Button size="sm" variant={selected ? "secondary" : "ghost"} aria-pressed={selected} loading={pending}
    disabled={session.status === "loading" || state.refreshing || (Boolean(session.user) && state.status === "loading") || (!available && !selected && !state.error)} onclick={() => { void toggle(); }}>
    {#snippet icon()}<Bookmark size="1em" fill={selected ? "currentColor" : "none"} />{/snippet}
    {state.error ? "重试收藏状态" : selected ? removeLabel ? "取消收藏" : "已收藏" : "收藏"}
</Button>