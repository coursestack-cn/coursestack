<script lang="ts">
    import { displayName } from "$lib/content/display-name";
    import { setTitle } from "$lib/router/router.svelte.js";
    import type { PageProps } from "$lib/router/types";
    import { getCourse } from "$lib/components/shell/CourseLayout.svelte";
    import Card from "$lib/components/ui/Card.svelte";

    let {}: PageProps = $props();
    const result = getCourse()!;

    $effect(() => {
        if (result.data) setTitle(result.data.course.name);
    });
</script>

{#if result.data}
    {@const course = result.data.course}
    <Card padding="lg">
        <dl class="course-info">
            <div>
                <dt>课程编号</dt>
                <dd class="course-code">{course.code}</dd>
            </div>
            <div>
                <dt>本学期教师</dt>
                <dd class:muted={!course.currentTeacher}>{course.currentTeacher ? displayName(course.currentTeacher) : "本学期未开课"}</dd>
            </div>
        </dl>
        <section class="introduction" aria-labelledby="course-introduction">
            <h2 id="course-introduction">课程简介</h2>
            <p class:muted={!course.introduction.trim()}>{course.introduction.trim() || "暂无课程简介"}</p>
        </section>
    </Card>
{/if}

<style>
    .course-info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); }
    .course-info > div { min-width: 0; display: grid; align-content: start; gap: var(--space-2); }
    dt { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    dd { font-size: var(--font-size-md); overflow-wrap: anywhere; }
    .course-code { font-family: var(--font-mono); }
    .introduction { display: grid; gap: var(--space-3); margin-top: var(--space-6); padding-top: var(--space-6); border-top: 1px solid var(--color-border); }
    h2 { font-size: var(--font-size-lg); }
    .introduction p { white-space: pre-wrap; overflow-wrap: anywhere; }
    .muted { color: var(--color-text-muted); }
    @media (max-width: 639px) { .course-info { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); } }
</style>