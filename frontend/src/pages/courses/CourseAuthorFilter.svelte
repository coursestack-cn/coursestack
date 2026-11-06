<script module lang="ts">
    import type { AuthorView } from "$lib/content/types";
    export type CourseAuthor = AuthorView & { shortId: string | null };
</script>

<script lang="ts">
    import { tick, untrack } from "svelte";
    import { Check, ChevronDown } from "@lucide/svelte";
    import { api } from "$lib/api/client";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { resource } from "$lib/api/resource.svelte";
    import { displayName } from "$lib/content/display-name";
    import AuthorSignature from "$lib/components/content/AuthorSignature.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import { encode, type Page } from "../questions/data";

    let { id, labelId, courseId, value, onchange }: {
        id: string; labelId: string; courseId: string; value: string; onchange: (value: string) => void;
    } = $props();
    let root: HTMLDivElement, trigger: HTMLButtonElement, panel: HTMLDivElement, search: HTMLInputElement;
    let open = $state(false), searchText = $state("");
    let items = $state<CourseAuthor[]>([]), total = $state(0), page = $state(0);
    let loading = $state(false), error = $state(""), activeIndex = $state(0);
    let left = $state(0), top = $state(0), availableHeight = $state(0);
    let picked = $state<{ courseId: string; author: CourseAuthor }>();
    let request: { courseId: string; q: string; controller: AbortController } | undefined;

    const selected = resource(async signal => {
        const course = courseId, authorId = value;
        if (!authorId) return { courseId: course, authorId, author: null };
        const query = new URLSearchParams({ authorId });
        const data = await api.get<Page<CourseAuthor>>(`/api/courses/${encode(course)}/content-authors?${query}`, { signal });
        return { courseId: course, authorId, author: data.items[0] ?? null };
    });
    const selection = $derived(selected.data?.courseId === courseId && selected.data.authorId === value ? selected.data : undefined);
    const author = $derived(selection ? selection.author : picked?.courseId === courseId && picked.author.id === value ? picked.author : undefined);
    const label = $derived(!value ? "全部" : author ? `${displayName(author)}${author.shortId ? ` · ${author.shortId}` : ""}`
        : selection ? "发布人不可用" : selected.status === "error" ? "发布人加载失败" : "正在加载…");

    async function load(current: NonNullable<typeof request>, nextPage: number) {
        loading = true;
        error = "";
        const query = new URLSearchParams({ page: String(nextPage), pageSize: "20" });
        if (current.q) query.set("q", current.q);
        try {
            const data = await api.get<Page<CourseAuthor>>(`/api/courses/${encode(current.courseId)}/content-authors?${query}`, { signal: current.controller.signal });
            if (current.controller.signal.aborted) return;
            items = nextPage === 1 ? data.items : [...items, ...data.items.filter(item => !items.some(existing => existing.id === item.id))];
            if (nextPage === 1) activeIndex = current.q && items.length ? 1 : Math.max(0, items.findIndex(item => item.id === value) + 1);
            total = data.total;
            page = data.page;
        } catch (cause) {
            if (!current.controller.signal.aborted && !isAborted(cause)) error = userMessage(cause);
        } finally {
            if (!current.controller.signal.aborted) loading = false;
        }
    }

    $effect(() => {
        const course = courseId, visible = open, q = searchText.trim();
        const current = { courseId: course, q, controller: new AbortController() };
        request = current;
        untrack(() => { items = []; total = 0; page = 0; activeIndex = 0; error = ""; loading = visible; });
        const timer = visible ? setTimeout(() => { void load(current, 1); }, q ? 200 : 0) : undefined;
        return () => { clearTimeout(timer); current.controller.abort(); };
    });

    async function loadNext() {
        const current = request, previousCount = items.length;
        if (!current) return;
        await load(current, page + 1);
        if (!open || current.controller.signal.aborted || error) return;
        activeIndex = items.length > previousCount ? previousCount + 1 : 0;
        await tick();
        if (open) {
            search.focus({ preventScroll: true });
            document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
        }
    }

    function close(restoreFocus = false) {
        if (!open) return;
        open = false;
        panel.hidePopover();
        if (restoreFocus) trigger.focus({ preventScroll: true });
    }

    function position() {
        if (!panel || !trigger) return;
        const rect = trigger.getBoundingClientRect(), viewport = window.visualViewport;
        const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
        const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0, margin = 8;
        left = Math.max(x + margin, Math.min(rect.left, x + width - panel.offsetWidth - margin));
        const below = y + height - rect.bottom - margin * 2, above = rect.top - y - margin * 2;
        const upward = below < 280 && above > below;
        availableHeight = Math.max(0, upward ? above : below);
        top = upward ? Math.max(y + margin, rect.top - Math.min(panel.scrollHeight, availableHeight) - margin) : rect.bottom + margin;
    }

    async function show() {
        searchText = "";
        open = true;
        panel.showPopover();
        await tick();
        if (!open) return;
        position();
        search.focus({ preventScroll: true });
    }

    function choose(item?: CourseAuthor) {
        picked = item ? { courseId, author: item } : undefined;
        close(true);
        onchange(item?.id ?? "");
    }

    async function keydown(event: KeyboardEvent) {
        if (event.isComposing) return;
        if (event.key === "Enter") {
            event.preventDefault();
            choose(activeIndex ? items[activeIndex - 1] : undefined);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length + 1) % (items.length + 1);
            await tick();
            document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
        }
    }

    $effect(() => {
        courseId; value;
        untrack(() => close());
    });
    $effect(() => {
        if (!open) return;
        items.length; loading;
        void tick().then(() => { if (open) position(); });
        window.addEventListener("resize", position);
        window.addEventListener("scroll", position, true);
        window.visualViewport?.addEventListener("resize", position);
        return () => {
            window.removeEventListener("resize", position);
            window.removeEventListener("scroll", position, true);
            window.visualViewport?.removeEventListener("resize", position);
        };
    });
</script>

<div class="author-filter" bind:this={root} onfocusout={event => {
    if (event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) close();
}}>
    <button type="button" {id} class="trigger" bind:this={trigger} aria-labelledby={`${labelId} ${id}-value`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`}
        onclick={() => { if (open) close(); else void show(); }}
        onkeydown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); void show(); } }}>
        <span id={`${id}-value`} class="value" title={label}>{label}</span><ChevronDown size="1em" aria-hidden="true" />
    </button>
    <div id={`${id}-panel`} class="panel" role="dialog" aria-label="选择发布人" popover="auto" tabindex="-1" bind:this={panel}
        style:left={`${left}px`} style:top={`${top}px`} style:max-height={availableHeight ? `${availableHeight}px` : undefined}
        ontoggle={event => { if (event.newState === "closed") open = false; }}
        onkeydown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } }}>
        <input bind:this={search} bind:value={searchText} class="search" type="text" role="combobox" aria-label="搜索发布人昵称"
            placeholder="搜索昵称" maxlength="80" autocomplete="off" aria-autocomplete="list" aria-expanded={open}
            aria-controls={`${id}-options`} aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined} onkeydown={keydown} />
        <div id={`${id}-options`} role="listbox" aria-label="发布人" class="options" aria-busy={loading}>
            <button type="button" id={`${id}-option-0`} role="option" class="option all" class:active={activeIndex === 0}
                aria-selected={!value} tabindex="-1" onmousedown={event => event.preventDefault()} onclick={() => choose()}>
                <span class="option-label">全部</span>{#if !value}<Check size="1em" aria-hidden="true" />{/if}
            </button>
            {#each items as item, index (item.id)}
                <button type="button" id={`${id}-option-${index + 1}`} role="option" class="option" class:active={activeIndex === index + 1}
                    aria-selected={value === item.id} tabindex="-1" onmousedown={event => event.preventDefault()} onclick={() => choose(item)}>
                    <span class="option-label"><AuthorSignature author={item} size="sm" />{#if item.shortId}<span class="short-id">{item.shortId}</span>{/if}</span>
                    {#if value === item.id}<Check size="1em" aria-hidden="true" />{/if}
                </button>
            {/each}
        </div>
        {#if loading}<p class="status" role="status">正在加载发布人…</p>
        {:else if error}<div class="status" role="status">{error}<Button size="sm" onclick={() => { void loadNext(); }}>重试</Button></div>
        {:else if !items.length}<p class="status" role="status">{searchText.trim() ? "没有匹配的发布人" : "暂无发布人"}</p>
        {:else if page * 20 < total}<Button size="sm" variant="ghost" onclick={() => { void loadNext(); }}>加载更多</Button>{/if}
        {#if value && selected.status === "error"}<div class="status" role="status">所选发布人加载失败。<Button size="sm" onclick={selected.reload}>重试</Button></div>{/if}
    </div>
</div>

<style>
    .author-filter { min-width: 0; width: 12rem; max-width: 100%; }
    .trigger { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); width: 100%; min-height: var(--space-10); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font: inherit; cursor: pointer; }
    .trigger:hover { border-color: var(--color-text-secondary); }
    .value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .trigger :global(svg), .option > :global(svg) { flex-shrink: 0; }
    .trigger :global(svg) { color: var(--color-text-secondary); }
    .panel { position: fixed; inset: auto; margin: 0; width: min(22rem, calc(100vw - var(--space-4))); padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-popover); overflow: auto; }
    .panel:popover-open { display: flex; flex-direction: column; gap: var(--space-2); }
    .search { flex-shrink: 0; width: 100%; min-height: var(--space-10); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font: inherit; }
    .search::placeholder { color: var(--color-text-muted); }
    .options { min-height: var(--space-10); max-height: 20rem; overflow-y: auto; flex: 0 1 auto; }
    .option { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); width: 100%; padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font: inherit; text-align: start; cursor: pointer; }
    .option.all { position: sticky; top: 0; z-index: 1; }
    .option:hover, .option.active { background: var(--color-surface-sunken); }
    .option[aria-selected="true"] { color: var(--color-accent); }
    .option-label { display: grid; min-width: 0; gap: var(--space-1); overflow-wrap: anywhere; }
    .short-id { color: var(--color-text-secondary); font-family: var(--font-mono); font-size: var(--font-size-xs); }
    .trigger:focus-visible, .search:focus-visible, .option:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: -2px; }
    .status { display: flex; flex-shrink: 0; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2); padding: var(--space-2); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
</style>