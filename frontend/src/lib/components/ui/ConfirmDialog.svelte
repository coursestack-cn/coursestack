<script module lang="ts">
    import type { Props as DialogProps } from "$lib/components/ui/Dialog.svelte";

    export type Props = Omit<DialogProps, "actions" | "dismissible"> & {
        description: string;
        danger?: boolean;
        confirmLabel?: string;
        cancelLabel?: string;
        onconfirm: () => void | Promise<void>;
        onerror?: (error: unknown) => void;
    };
</script>

<script lang="ts">
    import Button from "$lib/components/ui/Button.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";

    let { open = $bindable(false), title, description, danger = false, confirmLabel = "确认操作", cancelLabel = "取消",
        onconfirm, onerror, children, ...rest }: Props = $props();
    let pending = $state(false);

    async function confirm() {
        if (pending) return;
        pending = true;
        try {
            await onconfirm();
            open = false;
        } catch (error) {
            onerror?.(error);
        } finally {
            pending = false;
        }
    }
</script>

<Dialog {...rest} bind:open {title} {description} dismissible={!pending} aria-busy={pending || undefined}>
    {@render children?.()}
    {#snippet actions()}
        <Button disabled={pending} onclick={() => { open = false; }}>{cancelLabel}</Button>
        <Button variant={danger ? "danger" : "primary"} loading={pending} onclick={confirm}>{confirmLabel}</Button>
    {/snippet}
</Dialog>