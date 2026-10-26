<script lang="ts">
    import { onMount } from "svelte";
    import AppShell from "$lib/components/shell/AppShell.svelte";
    import RouterOutlet from "$lib/router/RouterOutlet.svelte";
    import NavigationPrompt from "$lib/router/NavigationPrompt.svelte";
    import { startRouter } from "$lib/router/router.svelte.js";
    import { session } from "$lib/session.svelte.js";

    onMount(() => {
        const stopRouter = startRouter();
        void session.initialize();
        return stopRouter;
    });
</script>

<AppShell><RouterOutlet /></AppShell>
<NavigationPrompt />