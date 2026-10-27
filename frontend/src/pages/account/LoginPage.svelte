<script lang="ts">
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import LoginForm from "./LoginForm.svelte";
    import type { PageProps } from "$lib/router/types";

    let {}: PageProps = $props();
</script>

<PageLayout title="成员登录" subtitle="使用管理员提供的学工号和密码登录课栈。" width="prose"><LoginForm /></PageLayout>