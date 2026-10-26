<script module lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    export type StateKind = "loading" | "empty" | "error" | "login-required" | "forbidden" | "unavailable";
    export type Props = Omit<HTMLAttributes<HTMLDivElement>, "children" | "title"> & {
        kind: StateKind;
        title?: string;
        description?: string;
        icon?: Snippet;
        actions?: Snippet;
        compact?: boolean;
    };
</script>

<script lang="ts">
    import { Inbox, CircleAlert, LogIn, ShieldX, FileX } from "@lucide/svelte";
    import Spinner from "$lib/components/ui/Spinner.svelte";

    let { kind, title, description, icon, actions, compact = false, class: className = "", ...rest }: Props = $props();
    const defaults = {
        loading: { title: "正在加载", description: "", icon: Inbox },
        empty: { title: "这里还没有内容", description: "", icon: Inbox },
        error: { title: "加载失败", description: "网络或服务出现问题，稍后重试。", icon: CircleAlert },
        "login-required": { title: "登录后继续", description: "浏览无需登录，发布、互动和下载需要登录。", icon: LogIn },
        forbidden: { title: "没有权限", description: "你的账号无法查看或操作这里的内容。", icon: ShieldX },
        unavailable: { title: "内容已不可用", description: "该内容已被下架或删除，相关讨论仍可阅读。", icon: FileX }
    };
    const state = $derived(defaults[kind]);
    const Icon = $derived(state.icon);
    const detail = $derived(description ?? state.description);
</script>

<div {...rest} class={`state-block ${kind} ${className}`} class:compact aria-busy={kind === "loading" || undefined}>
    <span class="icon" aria-hidden="true">
        {#if icon}{@render icon()}{:else if kind === "loading"}<Spinner />{:else}<Icon size="1em" />{/if}
    </span>
    <!-- Only transient states are announced; static states would all be read out on page load. -->
    <div class="copy" role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}>
        <p class="title">{title ?? state.title}</p>
        {#if detail}<p class="description">{detail}</p>{/if}
    </div>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
    .state-block { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-4); padding: var(--space-12) var(--space-6); min-width: 0; text-align: center; }
    .compact { gap: var(--space-2); padding: var(--space-5) var(--space-4); }
    .icon { display: flex; color: var(--color-text-secondary); font-size: var(--font-size-2xl); }
    .icon :global(svg) { width: 1em; height: 1em; }
    .error .icon { color: var(--color-danger); }
    .copy { display: grid; gap: var(--space-2); max-width: var(--width-prose); overflow-wrap: anywhere; }
    .title { font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); color: var(--color-text); }
    .compact .title { font-size: var(--font-size-md); }
    .description { font-size: var(--font-size-md); color: var(--color-text-secondary); }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); }
</style>