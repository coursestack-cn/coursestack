<script lang="ts">
    import { onDestroy } from "svelte";
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import RichText from "$lib/rich-text/RichText.svelte";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Field from "$lib/components/ui/Field.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import FilePreview from "$lib/components/files/FilePreview.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import { encode, type Content, type Page } from "../questions/data";
    import { type MaterialVersion } from "../materials/data";

    type Review = Omit<Content, "status"> & { status: "visible" | "hidden" | "deleted";
        actions: { id: number; version: number | null; newStatus: string; reason: string; createdAt: number }[] };
    let { id, reportId, oncomplete }: { id: string; reportId?: string; oncomplete: () => void } = $props();
    let deletionOpen = $state(false), versionDeletion = $state<number | null>(null);
    let reason = $state(""), pending = $state(false), error = $state("");
    let selectedVersion = $state(""), more = $state<MaterialVersion[]>([]), versionPage = $state(1), loadingVersions = $state(false);
    const controller = new AbortController();
    onDestroy(() => controller.abort());
    const result = resource(async signal => {
        const viewer = session.user?.id, contentId = id;
        const content = await api.get<Review>(`/api/moderation/contents/${encode(contentId)}`, { signal });
        const versions = content.kind === "material" && content.status !== "deleted"
            ? await api.get<Page<MaterialVersion>>(`/api/moderation/materials/${encode(contentId)}/versions?pageSize=50`, { signal }) : null;
        return { content, versions, viewer };
    });
    const content = $derived(result.data?.viewer === session.user?.id ? result.data?.content : undefined);
    const versions = $derived([...(result.data?.versions?.items ?? []), ...more]);
    const file = $derived(versions.find(v => String(v.version) === selectedVersion) ?? versions[0]);
    const validReason = $derived(Array.from(reason.trim()).length <= 1000);
    async function older() {
        if (loadingVersions) return;
        loadingVersions = true;
        try {
            const page = await api.get<Page<MaterialVersion>>(`/api/moderation/materials/${encode(id)}/versions?pageSize=50&page=${versionPage + 1}`, { signal: controller.signal });
            more = [...more, ...page.items]; versionPage = page.page;
        } catch (cause) { if (!controller.signal.aborted) toast.error(userMessage(cause)); }
        finally { loadingVersions = false; }
    }
    async function act(action: "hide" | "restore" | "none" | "delete") {
        if (!validReason || pending) return;
        pending = true; error = "";
        try {
            if (reportId) await api.patch(`/api/moderation/reports/${encode(reportId)}`, { action, resolution: reason.trim() }, { signal: controller.signal });
            else await api.put(`/api/contents/${encode(id)}/moderation`, { action, reason: reason.trim() }, { signal: controller.signal });
            if (controller.signal.aborted) return;
            toast.success(action === "none" ? "已处理举报，维持现状" : action === "delete" ? "内容及所属子内容已删除" : action === "hide" ? "内容已下架" : "内容已上架");
            reason = ""; result.reload(); oncomplete();
        } catch (cause) { if (!controller.signal.aborted) error = userMessage(cause); }
        finally { pending = false; }
    }
    async function deleteVersion() {
        if (versionDeletion === null || !validReason || pending) return;
        await api.delete(`/api/materials/${encode(id)}/versions/${versionDeletion}`, { reason: reason.trim() }, { signal: controller.signal });
        more = []; versionPage = 1; selectedVersion = ""; reason = "";
        toast.success("文件版本已删除"); result.reload(); oncomplete();
    }
</script>

<ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
    {#if content}
        <section class="review">
            <header><h2>{content.title ?? ({ question: "问题", material: "资料", answer: "回答", comment: "评论" }[content.kind])}</h2>
                <p>{content.author.nickname ?? "未设置昵称"}，{content.status === "hidden" ? "已下架" : content.status === "deleted" ? "已删除" : content.isPublic ? "已上架" : "所属内容不可用"}</p>
                <p>课程 {content.courseId}，<RelativeTime timestamp={content.createdAt} /></p>
            </header>
            {#if content.targetId}<Button href={`/courses/${encode(content.courseId)}/manage/reports?${new URLSearchParams({ tab: "contents", status: "all", content: content.targetId })}`}>查看上级内容</Button>{/if}
            {#if content.status !== "deleted"}<RichText doc={content.body} />{:else}<p>正文已删除，不能恢复。</p>{/if}
            {#if file}
                <section class="files"><h3>文件审查</h3>
                    <Field label="文件版本">{#snippet children({ id })}<Select {id} value={String(file.version)} options={versions.map(v => ({ value: String(v.version), label: `版本 ${v.version}` }))} onchange={event => { selectedVersion = event.currentTarget.value; }} fitOptions />{/snippet}</Field>
                    {#if versions.length < (result.data?.versions?.total ?? 0)}<Button loading={loadingVersions} onclick={() => { void older(); }}>加载更早版本</Button>{/if}
                    <FilePreview src={file.previewUrl ?? ""} name={content.title ?? "资料"} mime={file.mime} size={file.size} downloadHref={file.downloadUrl} />
                </section>
            {/if}
            {#if content.status !== "deleted" || reportId}
                <form onsubmit={event => event.preventDefault()}>
                    <Field label={reportId ? "处理说明" : "管理原因"} error={error || undefined}>
                        {#snippet children(control)}<Textarea {...control} bind:value={reason} placeholder="选填，说明审查依据（最多 1000 字）" disabled={pending} />{/snippet}
                    </Field>
                    <p class="hint">下架或删除会连带处理所属回答、评论和文件版本，并撤回相关自动奖励。评论之间的回复不连带处理。上架在原学期重新计分，删除无法恢复，手工调分保留。</p>
                    <div class="actions">
                        {#if reportId}
                            <Button loading={pending} disabled={!validReason} onclick={() => { void act("none"); }}>维持现状</Button>
                            {#if content.status !== "deleted"}<Button variant="danger" loading={pending} disabled={!validReason} onclick={() => { void act("hide"); }}>下架并处理举报</Button>{/if}
                        {:else}<Button variant={content.status === "hidden" ? "primary" : "danger"} loading={pending} disabled={!validReason}
                            onclick={() => { void act(content.status === "hidden" ? "restore" : "hide"); }}>{content.status === "hidden" ? "重新上架" : "下架内容"}</Button>{/if}
                        {#if content.status !== "deleted"}<Button variant="danger" loading={pending} disabled={!validReason} onclick={() => { deletionOpen = true; }}>{reportId ? "删除并处理举报" : "删除内容"}</Button>{/if}
                        {#if !reportId && file}<Button variant="danger" disabled={!validReason || pending || (result.data?.versions?.total ?? 0) <= 1}
                            title={result.data?.versions?.total === 1 ? "最后一个版本不能单独删除；如需移除，请删除整份资料。" : undefined}
                            onclick={() => { versionDeletion = file.version; }}>删除版本 {file.version}</Button>{/if}
                    </div>
                </form>
            {/if}
            {#if content.actions.length}<section class="history"><h3>管理记录</h3>
                {#each content.actions as action (action.id)}<article><p><strong>{action.version !== null ? `删除版本 ${action.version}` : action.newStatus === "deleted" ? "删除" : action.newStatus === "hidden" ? "下架" : "上架"}</strong> <RelativeTime timestamp={action.createdAt} /></p>{#if action.reason}<p>{action.reason}</p>{/if}</article>{/each}
            </section>{/if}
        </section>
    {/if}
</ResourceState>

<ConfirmDialog bind:open={deletionOpen} title="删除内容及所属子内容？" description="正文、所属回答、评论和文件版本将被删除，相关自动奖励将撤回。此操作无法恢复。" danger confirmLabel="删除" onconfirm={() => act("delete")} />
<ConfirmDialog open={versionDeletion !== null} onclose={() => { versionDeletion = null; }} title={`删除版本 ${versionDeletion ?? ""}？`} description="此文件版本将永久删除并撤回对应自动奖励。其他版本和评论会保留。" danger confirmLabel="删除版本" onconfirm={deleteVersion} onerror={cause => toast.error(userMessage(cause))} />

<style>
    .review, form, .history, .files { display: grid; gap: var(--space-4); min-width: 0; }
    .review { padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    h2 { font-size: var(--font-size-xl); overflow-wrap: anywhere; }
    header p, .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    header p { margin-top: var(--space-2); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    form, .history { padding-top: var(--space-4); border-top: 1px solid var(--color-border); }
    .history article { overflow-wrap: anywhere; }
</style>