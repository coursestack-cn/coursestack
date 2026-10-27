<script module lang="ts">
    import type { Props as ReasonDialogProps } from "./ReasonDialog.svelte";
    export type Props = Omit<ReasonDialogProps, "mode">;
</script>

<script lang="ts">
    import ReasonDialog from "./ReasonDialog.svelte";
    let { open = $bindable(false), ...rest }: Props = $props();
</script>

<ReasonDialog {...rest} bind:open mode="moderate" />