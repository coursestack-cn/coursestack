<script lang="ts">
    import { onMount } from "svelte";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import { registerLeavePrompt } from "$lib/router/leave.svelte.js";

    let open = $state(false);
    let answer: ((confirmed: boolean) => void) | undefined;

    function resolve(confirmed: boolean) {
        const callback = answer;
        answer = undefined;
        open = false;
        callback?.(confirmed);
    }

    onMount(() => {
        const remove = registerLeavePrompt(() => new Promise<boolean>((done) => {
            answer = done;
            open = true;
        }));
        return () => { resolve(false); remove(); };
    });

    $effect(() => { if (!open) resolve(false); });
</script>

<ConfirmDialog bind:open title="放弃未保存的内容？" description="离开后，尚未保存的修改将会丢失。"
    confirmLabel="放弃并离开" cancelLabel="继续编辑" danger onconfirm={() => resolve(true)} />