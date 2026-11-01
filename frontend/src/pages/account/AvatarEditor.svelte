<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { session } from "$lib/session.svelte.js";
    import { avatarSource } from "$lib/avatar/state.svelte.js";
    import { AVATAR_ACCEPT, AVATAR_SIZE, AvatarImageError, drawAvatar, exportAvatar, readAvatar, squareCrop } from "$lib/avatar/image";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { onBeforeLeave } from "$lib/router/leave.svelte.js";
    import Avatar from "$lib/components/ui/Avatar.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import Spinner from "$lib/components/ui/Spinner.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";

    let { accountId, name, src }: { accountId: string; name: string; src?: string } = $props();
    const id = $props.id();
    let input: HTMLInputElement;
    let preview = $state<HTMLCanvasElement>();
    let source = $state.raw<HTMLCanvasElement | null>(null);
    let open = $state(false);
    let loading = $state(false);
    let pending = $state(false);
    let error = $state("");
    let cropError = $state("");
    let zoom = $state(1);
    let centerX = $state(0.5), centerY = $state(0.5);
    let reader: AbortController | undefined;
    let alive = true;
    type Point = { x: number; y: number };
    type CropPointer = PointerEvent & { currentTarget: EventTarget & HTMLDivElement };
    const pointers = new Map<number, Point>();
    const current = $derived(avatarSource(accountId, src));
    const crop = $derived(squareCrop(source?.width ?? 1, source?.height ?? 1, zoom, centerX, centerY));

    onBeforeLeave(() => !open && !pending);
    onDestroy(() => { alive = false; reader?.abort(); });
    $effect(() => {
        if (!open) untrack(() => { reader?.abort(); reader = undefined; source = null; loading = false; pointers.clear(); });
    });
    $effect(() => { if (source && preview) drawAvatar(source, preview, crop); });

    function message(cause: unknown) {
        return cause instanceof AvatarImageError ? cause.message : userMessage(cause, {
            AVATAR_TOO_LARGE: "头像不能超过 2MiB。",
            INVALID_AVATAR: "无法读取头像，重新选择图片后重试。",
            AVATAR_TYPE_MISMATCH: "无法读取头像格式，重新选择图片后重试。",
            ACCOUNT_DELETED: "账号身份已变更，重新登录后再试。",
            default: "头像保存失败，稍后重试。"
        });
    }

    async function selectFile() {
        const file = input.files?.[0];
        input.value = "";
        if (!file || pending) return;
        reader?.abort();
        const request = new AbortController();
        reader = request;
        source = null;
        pointers.clear();
        zoom = 1;
        centerX = centerY = 0.5;
        error = cropError = "";
        open = loading = true;
        try {
            const result = await readAvatar(file, request.signal);
            if (alive && !request.signal.aborted) source = result;
        } catch (cause) {
            if (alive && !request.signal.aborted && !isAborted(cause)) cropError = message(cause);
        } finally {
            if (alive && reader === request) { reader = undefined; loading = false; }
        }
    }

    function startPointer(event: CropPointer) {
        if (!source || pending || event.button !== 0 || pointers.size >= 2) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    function transform(nextZoom: number, from: Point, to: Point, bounds: DOMRect) {
        if (!source) return;
        const previous = crop;
        zoom = Math.max(1, Math.min(4, nextZoom));
        const size = Math.min(source.width, source.height) / zoom;
        // Keep the image point under the cursor or finger midpoint in place while zooming.
        const x = previous.x + (from.x - bounds.left) / bounds.width * previous.size - (to.x - bounds.left) / bounds.width * size;
        const y = previous.y + (from.y - bounds.top) / bounds.height * previous.size - (to.y - bounds.top) / bounds.height * size;
        centerX = (Math.max(0, Math.min(source.width - size, x)) + size / 2) / source.width;
        centerY = (Math.max(0, Math.min(source.height - size, y)) + size / 2) / source.height;
    }

    function gesture() {
        const [first, second] = [...pointers.values()];
        return second ? { point: { x: (first!.x + second.x) / 2, y: (first!.y + second.y) / 2 },
            distance: Math.hypot(first!.x - second.x, first!.y - second.y) } : { point: first!, distance: 0 };
    }

    function movePointer(event: CropPointer) {
        if (!pointers.has(event.pointerId) || pending) return;
        const before = gesture();
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = gesture();
        const nextZoom = before.distance > 0 ? zoom * after.distance / before.distance : zoom;
        transform(nextZoom, before.point, after.point, event.currentTarget.getBoundingClientRect());
    }

    function endPointer(event: PointerEvent) { pointers.delete(event.pointerId); }

    function wheel(event: WheelEvent & { currentTarget: EventTarget & HTMLDivElement }) {
        if (!source || pending) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
        const delta = Math.max(-500, Math.min(500, event.deltaY * unit));
        const point = { x: event.clientX, y: event.clientY };
        transform(zoom * Math.exp(-delta * 0.002), point, point, bounds);
    }

    async function save() {
        if (!source || pending || loading) return;
        pending = true;
        cropError = "";
        try {
            const blob = await exportAvatar(source, crop);
            if (!alive) return;
            if (session.user?.id !== accountId) { cropError = "登录身份已改变，重新登录后再试。"; return; }
            // Once sent, let the shared session update finish even if the user leaves this page.
            const saved = await session.changeAvatar(blob);
            if (!alive) return;
            if (saved) { open = false; toast.success("头像已更新"); }
            else cropError = "登录身份已改变，重新登录后再试。";
        } catch (cause) {
            if (alive) cropError = message(cause);
        } finally { if (alive) pending = false; }
    }

    async function remove() {
        if (pending || !current) return;
        if (session.user?.id !== accountId) { error = "登录身份已改变，重新登录后再试。"; return; }
        pending = true;
        error = "";
        try {
            const saved = await session.changeAvatar(null);
            if (!alive) return;
            if (saved) toast.success("头像已移除");
            else error = "登录身份已改变，重新登录后再试。";
        } catch (cause) { if (alive) error = message(cause); }
        finally { if (alive) pending = false; }
    }
</script>

<section class="avatar-editor" aria-labelledby={`${id}-title`} aria-busy={pending || undefined}>
    <h3 id={`${id}-title`}>头像</h3>
    <div class="current-avatar">
        <Avatar {accountId} {name} {src} size="lg" alt="当前头像" />
        <div class="buttons">
            <Button disabled={pending} onclick={() => input.click()}>{current ? "更换头像" : "上传头像"}</Button>
            {#if current}<Button variant="ghost" loading={pending && !open} onclick={remove}>移除头像</Button>{/if}
        </div>
    </div>
    <input bind:this={input} type="file" accept={AVATAR_ACCEPT} aria-label="选择头像图片" hidden onchange={() => { void selectFile(); }} />
    <p class="hint">支持 PNG、JPEG、WebP，不超过 2MiB。</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<Dialog bind:open class="avatar-crop-dialog" title="裁切头像" dismissible={!pending} aria-busy={pending || loading || undefined}>
    {#if loading}<div class="reading"><Spinner label="正在读取图片" /><span>正在读取图片…</span></div>
    {:else if source}
        <div class="crop-viewport" class:pending role="img" aria-label="头像裁切预览"
            onpointerdown={startPointer} onpointermove={movePointer} onpointerup={endPointer}
            onpointercancel={endPointer} onlostpointercapture={endPointer} onwheel={wheel}>
            <canvas bind:this={preview} width={AVATAR_SIZE} height={AVATAR_SIZE} aria-hidden="true"></canvas>
            <span class="crop-grid" aria-hidden="true"></span>
            <span class="circle-guide" aria-hidden="true"></span>
        </div>
    {/if}
    {#if cropError}<p class="error crop-error" role="alert">{cropError}</p>{/if}
    {#snippet actions()}
        <Button disabled={pending} onclick={() => { open = false; }}>取消</Button>
        <Button disabled={pending} onclick={() => input.click()}>重新选图</Button>
        <Button variant="primary" loading={pending} disabled={!source || loading} onclick={save}>确认上传</Button>
    {/snippet}
</Dialog>

<style>
    .avatar-editor { display: grid; gap: var(--space-3); min-width: 0; }
    h3 { font-size: var(--font-size-md); }
    .current-avatar, .buttons, .reading { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
    .current-avatar { gap: var(--space-8); }
    .current-avatar :global(.avatar) { width: calc(var(--space-10) * 2); height: calc(var(--space-10) * 2); }
    .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .error { color: var(--color-danger); overflow-wrap: anywhere; }
    :global(dialog.dialog.avatar-crop-dialog) { width: min(calc(20rem + var(--space-5) * 2), calc(100% - var(--space-8))); }
    :global(dialog.avatar-crop-dialog > .body) { padding: var(--space-5); }
    .crop-viewport { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; background: var(--color-surface-sunken); cursor: grab; touch-action: none; user-select: none; }
    .crop-viewport:active { cursor: grabbing; }
    .crop-viewport.pending { cursor: wait; }
    canvas { display: block; width: 100%; height: 100%; pointer-events: none; }
    .crop-grid { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to right, transparent 33%, #fff6 33%, #fff6 calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, #fff6 66%, #fff6 calc(66% + 1px), transparent calc(66% + 1px)), linear-gradient(to bottom, transparent 33%, #fff6 33%, #fff6 calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, #fff6 66%, #fff6 calc(66% + 1px), transparent calc(66% + 1px)); }
    .circle-guide { position: absolute; inset: 0; border: 1px solid #fffa; border-radius: 50%; box-shadow: 0 0 0 5rem #0003; pointer-events: none; }
</style>