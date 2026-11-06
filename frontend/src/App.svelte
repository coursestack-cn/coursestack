<script lang="ts">
    import { onMount } from "svelte";
    import AppShell from "$lib/components/shell/AppShell.svelte";
    import RouterOutlet from "$lib/router/RouterOutlet.svelte";
    import NavigationPrompt from "$lib/router/NavigationPrompt.svelte";
    import { startRouter } from "$lib/router/router.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import { watchBonusNotifications } from "$lib/bonus-notifications.svelte.js";

    import { startFavoriteSync } from "$lib/favorites.svelte";

    watchBonusNotifications();

    onMount(() => {
        const stopRouter = startRouter();
        void session.initialize();
        const stopFavorites = startFavoriteSync();
        return () => { stopRouter(); stopFavorites(); };
    });
</script>

<AppShell><RouterOutlet /></AppShell>
<NavigationPrompt />