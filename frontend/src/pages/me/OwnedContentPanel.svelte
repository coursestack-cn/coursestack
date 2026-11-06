<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import RichText from "$lib/rich-text/RichText.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import BodyComposer from "../questions/BodyComposer.svelte";
    import { encode, urlId, type Content } from "../questions/data";

    type OwnedContent = Omit<Content, "status"> & { status: "visible" | "hidden" | "deleted";
        actions: { id: number; version: number | null; newStatus: string; reason: string; createdAt: number }[] };
    let { id, showFiles = true }: { id: string; showFiles?: boolean } = $props();
    let editing = $state(false), deleting = $state(false);
    const result = resource(async signal => {
        const viewer = session.user?.id;
        return { content: await api.get<OwnedContent>(`/api/me/contents/${encode(id)}`, { signal }), viewer };
    });
    const content = $derived(result.data?.viewer === session.user?.id ? result.data?.content : undefined);
    const base = $derived(content ? `/${content.kind === "material" ? "materials" : "questions"}/${encode(urlId(content.id))}` : "");
    async function remove() {
        await api.delete(`/api/contents/${encode(id)}`);
        toast.success("内容已删除"); result.reload();
    }
</script>

<ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
    {#if content}
        <section class="owned-content">
            <div class="notice">
                <strong>{content.status === "deleted" ? "内容已删除" : content.status === "hidden" ? "内容已下架" : !content.isPublic ? "所属内容不可用，暂不公开" : "内容已上架"}</strong>
                {#if content.status === "hidden"}<p>你仍可编辑内容；删除需满足没有回答、评论或采纳的条件。修改后请通过站外途径联系课程教师或管理员，审核通过后由管理者重新上架。</p>
                {:else if content.status === "deleted"}<p>正文已删除，无法恢复。</p>
                {:else if !content.isPublic}<p>你仍可维护自己的内容；是否公开取决于上级内容的状态。</p>{/if}
            </div>
            {#if content.title}<h2>{content.title}</h2>{/if}
            {#if content.status !== "deleted"}
                {#if editing}
                    {#key content.id}<BodyComposer label="编辑正文" path={`/api/contents/${encode(content.id)}`} initial={content.body}
                        oncomplete={() => { editing = false; result.reload(); }} oncancel={() => { editing = false; }} />{/key}
                {:else}
                    <RichText doc={content.body} />
                    <div class="actions">
                        {#if content.kind === "question" || content.kind === "material"}<Button href={`${base}/edit`}>编辑内容</Button>
                        {:else}<Button onclick={() => { editing = true; }}>编辑内容</Button>{/if}
                        <Button variant="danger" disabled={!content.canDelete} onclick={() => { deleting = true; }}>删除内容</Button>
                        {#if !content.canDelete}<p>已有回答、评论或采纳，请联系课程教师或管理员处理删除。</p>{/if}
                        {#if content.kind === "material" && showFiles}<Button href={base}>查看和维护文件版本</Button>{/if}
                    </div>
                {/if}
            {/if}
            {#if content.actions.length}
                <section class="history"><h3>管理记录</h3>
                    {#each content.actions as action (action.id)}<article>
                        <p><strong>{action.version !== null ? `删除版本 ${action.version}` : action.newStatus === "deleted" ? "删除" : action.newStatus === "hidden" ? "下架" : "上架"}</strong> <RelativeTime timestamp={action.createdAt} /></p>
                        {#if action.reason}<p>{action.reason}</p>{/if}
                    </article>{/each}
                </section>
            {/if}
        </section>
    {/if}
</ResourceState>
<ConfirmDialog bind:open={deleting} title="删除内容？" description="标题、正文和标签将永久删除，无法通过上架恢复。" danger confirmLabel="删除"
    onconfirm={remove} onerror={error => toast.error(userMessage(error))} />

<style>
    .owned-content, .history { display: grid; min-width: 0; gap: var(--space-4); }
    .notice { padding: var(--space-4); background: var(--color-surface-sunken); border-radius: var(--radius-md); }
    .notice p { margin-top: var(--space-2); color: var(--color-text-secondary); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    h2 { font-size: var(--font-size-xl); overflow-wrap: anywhere; }
    .history article { padding-block: var(--space-3); border-top: 1px solid var(--color-border); overflow-wrap: anywhere; }
    .history p + p { margin-top: var(--space-2); }
</style>