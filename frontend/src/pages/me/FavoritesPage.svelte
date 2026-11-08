<script lang="ts">
    import { type PageProps } from "$lib/router/types";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import FavoriteList from "./FavoriteList.svelte";

    let {}: PageProps = $props();
</script>

<PageLayout title="我的收藏"><FavoriteList /></PageLayout>