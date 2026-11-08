<script lang="ts">
    import FavoriteButton from "$lib/components/content/FavoriteButton.svelte";
    import { displayName } from "$lib/content/display-name";
    import { router, setTitle, updateQuery } from "$lib/router/router.svelte.js";
    import type { PageProps } from "$lib/router/types";
    import { getCourse } from "$lib/components/shell/CourseLayout.svelte";
    import CourseContents from "./CourseContents.svelte";
    import Card from "$lib/components/ui/Card.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Dialog from "$lib/components/ui/Dialog.svelte";
    import { session } from "$lib/session.svelte.js";
    import CourseBonusPolicy from "./CourseBonusPolicy.svelte";
    import CourseBonusHistory from "./CourseBonusHistory.svelte";
    import { courseManageHref } from "../manage/course";

    let {}: PageProps = $props();
    const result = getCourse()!;
    let policyOpen = $state(false);
    let historyOpen = $state(false);
    const student = $derived(session.status === "authenticated" && session.user?.role === "student" && !session.user.mustChangePassword);

    $effect(() => {
        const show = student && router.query.get("bonus") === "history";
        historyOpen = show;
        if (show) policyOpen = false;
    });

    function closeHistory() {
        if (!historyOpen && router.query.get("bonus") === "history") void updateQuery({ bonus: null }, { replace: true });
    }

    $effect(() => {
        if (result.data) setTitle(`${result.data.course.name}${result.data.term ? ` · ${result.data.term.name}` : ""}`);
    });
</script>

{#if result.data}
    {@const course = result.data.course}
    {@const term = result.data.term}
    {@const teachers = result.data.teachers}
    {@const manageHref = result.data.viewer === session.user?.id && result.data.permissions.canManageContent ? courseManageHref(course, session.user) : undefined}
    <Card padding="lg">
        <dl class="course-info">
            <div>
                <dt>课程编号</dt>
                <dd class="course-code">{course.id}</dd>
            </div>
            <div>
                <dt>{term ? `${term.name}教师` : "本学期教师"}</dt>
                <dd class:muted={!teachers.length}>
                    {#each teachers as teacher, index (teacher.id)}{#if index}、{/if}{#if teacher.isDeleted}{displayName(teacher)}{:else}<Link href={`/teachers/${encodeURIComponent(teacher.id)}`}>{displayName(teacher)}</Link>{/if}
                    {:else}{term || course.offeredInCurrentTerm ? "暂无教师" : "本学期未开课"}{/each}
                </dd>
            </div>
        </dl>
        <section class="introduction" aria-labelledby="course-introduction">
            <div class="introduction-heading">
                <h2 id="course-introduction">课程简介</h2>
                <div class="bonus-actions">
                    <FavoriteButton type="course" id={course.id} />
                    {#if !term || term.current}<Button size="sm" onclick={() => { policyOpen = true; }}>加分规则</Button>{/if}
                    {#if student}<Button size="sm" onclick={() => { void updateQuery({ bonus: "history", bonusTerm: term?.id ?? null, bonusPage: null }); }}>加分历史</Button>{/if}
                </div>
            </div>
            <p class:muted={!course.introduction.trim()}>{course.introduction.trim() || "暂无课程简介"}</p>
        </section>
    </Card>
    <CourseContents {course} terms={result.data.terms} defaultTermId={term?.id ?? ""} />
    <Dialog bind:open={policyOpen} title="加分规则" description={course.name}>
        {#if policyOpen}{#key session.user?.id}<CourseBonusPolicy courseId={course.id} {manageHref} />{/key}{/if}
    </Dialog>
    <Dialog bind:open={historyOpen} title="我的加分历史" description={course.name} onclose={closeHistory}>
        {#if historyOpen && student}{#key `${session.user?.id}:${course.id}`}<CourseBonusHistory courseId={course.id} />{/key}{/if}
    </Dialog>
{/if}

<style>
    .course-info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); }
    .course-info > div { min-width: 0; display: grid; align-content: start; gap: var(--space-2); }
    dt { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    dd { font-size: var(--font-size-md); overflow-wrap: anywhere; }
    .course-code { font-family: var(--font-mono); }
    .introduction { display: grid; gap: var(--space-3); margin-top: var(--space-6); padding-top: var(--space-6); border-top: 1px solid var(--color-border); }
    h2 { font-size: var(--font-size-lg); }
    .introduction-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-4); }
    .bonus-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-left: auto; }
    .introduction p { white-space: pre-wrap; overflow-wrap: anywhere; }
    .muted { color: var(--color-text-muted); }
    @media (max-width: 639px) { .course-info { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); } }
</style>