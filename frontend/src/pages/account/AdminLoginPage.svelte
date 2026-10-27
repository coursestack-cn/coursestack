<script lang="ts">
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import LoginForm from "./LoginForm.svelte";
    import type { PageProps } from "$lib/router/types";

    let {}: PageProps = $props();
</script>

<PageLayout title="管理员登录" subtitle="此入口仅供平台管理员使用。" width="prose"><LoginForm admin /></PageLayout>