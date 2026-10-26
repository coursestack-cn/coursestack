<script lang="ts">
    import { FileQuestion } from "@lucide/svelte";
    import StateBlock from "$lib/components/ui/StateBlock.svelte";
    import Button from "$lib/components/ui/Button.svelte";
</script>

<StateBlock kind="empty" title="404 · 页面未找到" description="这个地址没有对应的页面，请检查链接或返回首页。">
    {#snippet icon()}<FileQuestion size="1em" />{/snippet}
    {#snippet actions()}<Button href="/">返回首页</Button>{/snippet}
</StateBlock>