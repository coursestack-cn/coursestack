<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
        kind: "question" | "answer" | "comment" | "material";
        canEdit?: boolean;
        canDelete?: boolean;
        canReport?: boolean;
        canModerate?: boolean;
        onedit?: () => void;
        editHref?: string;
        ondelete?: () => Promise<void>;
        onreport?: (reason: string) => Promise<void>;
        onmoderate?: (reason: string) => Promise<void>;
        disabled?: boolean;
    };
</script>

<script lang="ts">
    import { onDestroy } from "svelte";
    import { Ellipsis, Flag, Pencil, Trash2, EyeOff } from "@lucide/svelte";
    import Menu, { type MenuItem } from "../ui/Menu.svelte";
    import Button from "../ui/Button.svelte";
    import ConfirmDialog from "../ui/ConfirmDialog.svelte";
    import { toast } from "../ui/toast.svelte.js";
    import { isAborted, userMessage } from "../../api/errors";
    import ReportDialog from "./ReportDialog.svelte";
    import ModerateDialog from "./ModerateDialog.svelte";

    let { kind, canEdit = false, canDelete = false, canReport = false, canModerate = false,
        onedit, editHref, ondelete, onreport, onmoderate, disabled = false, class: className = "", ...rest }: Props = $props();
    let reportOpen = $state(false);
    let moderateOpen = $state(false);
    let deleting = $state(false);
    let deletion = $state<{ id: number; open: boolean; callback: () => Promise<void> } | null>(null);
    let nextId = 0;
    let alive = true;
    const labels = { question: "问题", answer: "回答", comment: "评论", material: "资料" };
    const descriptions = {
        comment: "删除后评论内容将被清空，回复仍会保留。",
        answer: "删除后回答及其评论都不再显示，且无法恢复。",
        question: "删除后问题及其回答、评论都不再显示，且无法恢复。",
        material: "删除后资料及其版本、评论都不再显示，且无法恢复。"
    };
    const items = $derived.by(() => {
        const available: MenuItem[] = [];
        if (canEdit && (onedit || editHref)) available.push({ label: "编辑", icon: editIcon, ...(editHref ? { href: editHref } : { onselect: onedit }) });
        if (canDelete && ondelete) available.push({ label: "删除", icon: deleteIcon, danger: true, onselect: () => {
            if (!disabled && !deleting && ondelete) deletion = { id: ++nextId, open: true, callback: ondelete };
        } });
        if (canReport && onreport) available.push({ label: "举报", icon: reportIcon, onselect: () => { reportOpen = true; } });
        if (canModerate && onmoderate) available.push({ label: "下架", icon: moderateIcon, danger: true, onselect: () => { moderateOpen = true; } });
        return available.map((item) => ({ ...item, disabled: disabled || deleting }));
    });

    $effect(() => {
        if (!canReport || !onreport || disabled) reportOpen = false;
        if (!canModerate || !onmoderate || disabled) moderateOpen = false;
    });
    onDestroy(() => { alive = false; });

    async function remove(callback: () => Promise<void>) {
        if (disabled || deleting || !canDelete) return;
        deleting = true;
        try { await callback(); }
        finally { if (alive) deleting = false; }
    }

    function deleteError(error: unknown) {
        if (alive && !isAborted(error)) toast.error(userMessage(error));
    }

    async function report(reason: string) {
        if (disabled || !canReport || !onreport) throw new Error("Report action unavailable");
        await onreport(reason);
    }

    async function moderate(reason: string) {
        if (disabled || !canModerate || !onmoderate) throw new Error("Moderation action unavailable");
        await onmoderate(reason);
    }
</script>

{#snippet editIcon()}<Pencil size="1em" />{/snippet}
{#snippet deleteIcon()}<Trash2 size="1em" />{/snippet}
{#snippet reportIcon()}<Flag size="1em" />{/snippet}
{#snippet moderateIcon()}<EyeOff size="1em" />{/snippet}

<div {...rest} class={`content-actions ${className}`} aria-busy={deleting || undefined}>
    {#if items.length}
        <Menu {items}>
            {#snippet trigger(props)}
                <Button {...props} iconOnly variant="ghost" size="sm" aria-label="更多操作" disabled={disabled || deleting}>
                    <Ellipsis size="1em" aria-hidden="true" />
                </Button>
            {/snippet}
        </Menu>
    {/if}
    {#if deletion}
        {#key deletion.id}
            {@const current = deletion}
            <ConfirmDialog bind:open={current.open} title={`删除${labels[kind]}？`} description={descriptions[kind]}
                danger confirmLabel={`删除${labels[kind]}`} onconfirm={() => remove(current.callback)} onerror={deleteError} />
        {/key}
    {/if}
    <ReportDialog bind:open={reportOpen} onsubmit={report} />
    <ModerateDialog bind:open={moderateOpen} onsubmit={moderate} />
</div>

<style>
    .content-actions { display: inline-flex; align-items: center; max-width: 100%; }
</style>