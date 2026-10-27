<script lang="ts">
    import PagePlaceholder from "$lib/components/shell/PagePlaceholder.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";
    import type { PageProps } from "$lib/router/types";

    let { params }: PageProps = $props();
    let draft = $state("");
    onBeforeLeave(() => draft.length === 0);
</script>

<PagePlaceholder {params}>
    <Field label="编辑演示" help="输入内容后离开页面，会询问是否放弃修改。此处不保存或提交内容。">
        {#snippet children({ id, describedBy })}
            <Textarea {id} aria-describedby={describedBy} bind:value={draft} rows={4} />
        {/snippet}
    </Field>
    <div><Button disabled={!draft} onclick={() => { draft = ""; }}>清空演示内容</Button></div>
</PagePlaceholder>