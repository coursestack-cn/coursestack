<script lang="ts">
    import type { PageProps } from "$lib/router/types";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    let { params: _params }: PageProps = $props();
</script>

<PageLayout title="个人设置" width="prose">
    <Card padding="lg">
        <div class="security">
            <h2>账号安全</h2>
            <p>修改密码后，需要在所有设备上重新登录。</p>
            <div><Button href="/settings/password">修改密码</Button></div>
        </div>
    </Card>
</PageLayout>

<style>
    .security { display: grid; gap: var(--space-4); }
    p { color: var(--color-text-secondary); }
</style>