<script module lang="ts">
    import type { HTMLAttributes } from "svelte/elements";
    import type { AuthorView } from "$lib/content/types";

    export type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
        author: AuthorView;
        size?: "sm" | "md";
        createdAt?: number;
        editedAt?: number | null;
    };
</script>

<script lang="ts">
    import Avatar from "$lib/components/ui/Avatar.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import RelativeTime from "$lib/components/content/RelativeTime.svelte";
    import { displayName } from "$lib/content/display-name";
    import { formatRelativeTime } from "$lib/content/relative-time";

    let { author, size = "md", createdAt, editedAt, class: className = "", ...rest }: Props = $props();
    const name = $derived(displayName(author));
    const teacher = $derived(!author.isDeleted && (author.isCourseTeacher ? "本课程教师" : author.isTeacher ? "教师" : undefined));
    const edited = $derived(editedAt !== undefined && editedAt !== null);
</script>

<span {...rest} class={`author-signature ${size} ${className}`}>
    <!-- A blank name makes Avatar show its neutral placeholder instead of an initial. -->
    <Avatar name={author.isDeleted ? "" : author.nickname ?? ""} src={author.isDeleted ? undefined : author.avatarUrl ?? undefined}
        {size} alt="" aria-hidden="true" />
    <span class="details">
        <span class="identity"><span class="name">{name}</span>{#if teacher}<Badge tone="teacher">{teacher}</Badge>{/if}</span>
        {#if createdAt !== undefined || edited}
            <span class="metadata">
                {#if createdAt !== undefined}<RelativeTime timestamp={createdAt} />{/if}
                {#if edited}<span title={`编辑时间：${formatRelativeTime(editedAt!).title}`}>已编辑</span>{/if}
            </span>
        {/if}
    </span>
</span>

<style>
    .author-signature { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; max-width: 100%; color: var(--color-text); font-size: var(--font-size-md); }
    .details { display: grid; min-width: 0; gap: var(--space-1); }
    .identity, .metadata { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
    .name { min-width: 0; font-weight: var(--font-weight-bold); overflow-wrap: anywhere; }
    .metadata { color: var(--color-text-secondary); font-size: var(--font-size-xs); }
    .sm { font-size: var(--font-size-sm); }
</style>