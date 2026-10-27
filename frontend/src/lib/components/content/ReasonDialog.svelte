<script module lang="ts">
    import type { Props as DialogProps } from "../ui/Dialog.svelte";

    export type Props = Omit<DialogProps, "children" | "actions" | "title" | "description" | "dismissible" | "closeOnBackdrop" | "onsubmit"> & {
        mode: "report" | "moderate";
        onsubmit: (reason: string) => Promise<void>;
    };
</script>

<script lang="ts">
    import { onDestroy } from "svelte";
    import Dialog from "../ui/Dialog.svelte";
    import Button from "../ui/Button.svelte";
    import Field from "../ui/Field.svelte";
    import Select from "../ui/Select.svelte";
    import Textarea from "../ui/Textarea.svelte";
    import { toast } from "../ui/toast.svelte.js";
    import { isAborted, userMessage } from "../../api/errors";
    import { REPORT_CATEGORIES, moderationReason, reasonLength, reportReason } from "./reason";

    const formId = $props.id();
    let { open = $bindable(false), mode, onsubmit, ...rest }: Props = $props();
    let category = $state("");
    let detail = $state("");
    let categoryError = $state("");
    let detailError = $state("");
    let requestError = $state("");
    let pending = $state(false);
    let generation = 0;
    let alive = true;
    const options = [{ value: "", label: "选择举报类别", disabled: true }, ...REPORT_CATEGORIES.map((label) => ({ value: label, label }))];
    const reporting = $derived(mode === "report");
    const length = $derived(reasonLength(reporting ? (detail.trim() ? `${category}：${detail.trim()}` : category) : detail.trim()));

    $effect(() => {
        const isOpen = open;
        mode;
        generation += 1;
        pending = false;
        if (isOpen) {
            category = "";
            detail = "";
            categoryError = "";
            detailError = "";
            requestError = "";
        }
    });
    onDestroy(() => { alive = false; generation += 1; });

    async function submit(event: SubmitEvent) {
        event.preventDefault();
        if (pending || !open) return;
        categoryError = "";
        detailError = "";
        requestError = "";
        const result = reporting ? reportReason(category, detail) : moderationReason(detail);
        if (!result.ok) {
            if (result.field === "category") categoryError = result.message;
            else detailError = result.message;
            document.getElementById(`${formId}-${result.field}`)?.focus();
            return;
        }
        const current = generation;
        const modeAtStart = mode;
        pending = true;
        try {
            await onsubmit(result.reason);
            if (!alive || current !== generation || !open) return;
            open = false;
            toast.success(modeAtStart === "report" ? "已提交举报" : "已下架内容");
        } catch (error) {
            if (!alive || current !== generation || !open || isAborted(error)) return;
            requestError = userMessage(error, modeAtStart === "report" ? {
                409: "你已经举报过这条内容，等待处理即可。"
            } : {});
        } finally {
            if (alive && current === generation) pending = false;
        }
    }
</script>

<Dialog {...rest} bind:open title={reporting ? "举报内容" : "下架内容"}
    description={reporting ? "选择举报类别，并补充有助于核实的说明。" : "下架后，该内容及其下方内容将不再公开显示。"}
    dismissible={!pending} aria-busy={pending || undefined}>
    <form id={formId} class="reason-form" onsubmit={submit} novalidate>
        {#if reporting}
            <Field id={`${formId}-category`} label="举报类别" required error={categoryError}>
                {#snippet children(control)}
                    <Select id={control.id} aria-describedby={control.describedBy} invalid={control.invalid} {options}
                        bind:value={category} disabled={pending} required onchange={() => { categoryError = ""; detailError = ""; requestError = ""; }} />
                {/snippet}
            </Field>
        {/if}
        <Field id={`${formId}-detail`} label={reporting ? "补充说明" : "下架原因"} required={!reporting || category === "其他"}
            help={reporting ? "举报理由共 3–1000 字，包含类别；选择“其他”时须补充说明。" : "填写 3–1000 字，说明下架依据。"} error={detailError}>
            {#snippet children(control)}
                <Textarea id={control.id} aria-describedby={control.describedBy} invalid={control.invalid}
                    bind:value={detail} disabled={pending} rows={5} required={control.required}
                    oninput={() => { detailError = ""; requestError = ""; }} />
            {/snippet}
        </Field>
        <p class="counter" class:over-limit={length > 1000}>{length} / 1000 字</p>
        {#if requestError}<p class="request-error" role="alert">{requestError}</p>{/if}
    </form>
    {#snippet actions()}
        <Button disabled={pending} onclick={() => { open = false; }}>取消</Button>
        <Button type="submit" form={formId} variant={reporting ? "primary" : "danger"} loading={pending}>
            {reporting ? "提交举报" : "确认下架"}
        </Button>
    {/snippet}
</Dialog>

<style>
    .reason-form { display: grid; gap: var(--space-4); min-width: 0; }
    .counter { font-size: var(--font-size-sm); color: var(--color-text-secondary); text-align: end; }
    .over-limit, .request-error { color: var(--color-danger); }
    .request-error { font-size: var(--font-size-md); overflow-wrap: anywhere; }
</style>