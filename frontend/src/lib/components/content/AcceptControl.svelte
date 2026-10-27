<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        accepted: boolean;
        otherAccepted?: boolean;
        onaccept: () => Promise<void>;
        onunaccept: () => Promise<void>;
        disabled?: boolean;
    };
</script>

<script lang="ts">
    import { onDestroy } from "svelte";
    import { Check, Undo2 } from "@lucide/svelte";
    import Button from "../ui/Button.svelte";
    import ConfirmDialog from "../ui/ConfirmDialog.svelte";
    import { toast } from "../ui/toast.svelte.js";
    import { isAborted, userMessage } from "../../api/errors";

    type Action = "accept" | "replace" | "unaccept";
    let { accepted, otherAccepted = false, onaccept, onunaccept, disabled = false, class: className = "", ...rest }: Props = $props();
    let pending = $state(false);
    let confirmation = $state<{ id: number; open: boolean; action: Action; callback: () => Promise<void> } | null>(null);
    let nextId = 0;
    let alive = true;
    onDestroy(() => { alive = false; });

    function errorMessage(error: unknown) {
        if (alive && !isAborted(error)) toast.error(userMessage(error));
    }

    async function run(action: Action, callback: () => Promise<void>) {
        if (pending || disabled) return;
        // A page refresh may have changed the acceptance while the confirmation was open.
        if ((action === "unaccept" && !accepted) || (action !== "unaccept" && accepted)
            || (action === "accept" && otherAccepted)) return;
        pending = true;
        try { await callback(); }
        finally { if (alive) pending = false; }
    }

    function choose() {
        if (pending || disabled) return;
        if (accepted || otherAccepted) {
            confirmation = { id: ++nextId, open: true, action: accepted ? "unaccept" : "replace", callback: accepted ? onunaccept : onaccept };
        } else {
            void run("accept", onaccept).catch(errorMessage);
        }
    }
</script>

<div {...rest} class={`accept-control ${className}`} aria-busy={pending || undefined}>
    <Button size="sm" variant="ghost" {disabled} loading={pending} onclick={choose} aria-label={accepted ? "取消采纳此回答" : "采纳此回答"}>
        {#snippet icon()}{#if accepted}<Undo2 size="1em" />{:else}<Check size="1em" />{/if}{/snippet}
        {accepted ? "取消采纳" : "采纳"}
    </Button>
    {#if confirmation}
        {#key confirmation.id}
            {@const current = confirmation}
            <ConfirmDialog bind:open={current.open} title={current.action === "unaccept" ? "取消采纳？" : "更换采纳答案？"}
                description={current.action === "unaccept" ? "取消后会撤回原采纳带来的积分。" : "更换后会撤回原采纳带来的积分，并采纳此回答。"}
                confirmLabel={current.action === "unaccept" ? "取消采纳" : "更换采纳"}
                onconfirm={() => run(current.action, current.callback)} onerror={errorMessage} />
        {/key}
    {/if}
</div>

<style>
    .accept-control { display: inline-flex; align-items: center; max-width: 100%; }
</style>