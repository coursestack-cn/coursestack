<script module lang="ts">
    import { getContext, setContext, type Snippet } from "svelte";
    import type { Resource } from "$lib/api/resource.svelte.js";

    import type { Term, Teacher } from "../../../pages/manage/course";

    type CourseEntry = {
        course: import("../../../pages/manage/course").Course;
        term: Term | null; terms: Term[]; myTerms: Term[]; teachers: Teacher[];
        permissions: { canManageContent: boolean; canManageCourse: boolean };
        viewer: string | undefined;
    };

    const courseContext = Symbol("course");
    export const getCourse = () => getContext<Resource<CourseEntry> | undefined>(courseContext);
</script>

<script lang="ts">
    import { api, ApiError } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte.js";
    import { session } from "$lib/session.svelte.js";
    import { navigate, router } from "$lib/router/router.svelte.js";
    import Field from "$lib/components/ui/Field.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import CourseNav from "$lib/components/shell/CourseNav.svelte";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";
    import { courseManageHref } from "../../../pages/manage/course";

    let { courseCode, termId, children }: { courseCode: string; termId?: string; children: Snippet } = $props();
    const result = resource(async (signal) => {
        const code = courseCode, viewer = session.user?.id, selectedTerm = termId;
        if (!code.trim() || code.trim().length > 40) throw new ApiError(404, "COURSE_NOT_FOUND", "课程不存在");
        const entry = await api.get<Omit<CourseEntry, "viewer">>(`/api/courses/${encodeURIComponent(code)}/entry${selectedTerm === undefined ? "" : `?${new URLSearchParams({ termId: selectedTerm })}`}`, { signal });
        return { ...entry, viewer };
    });
    setContext(courseContext, result);
    const courseOverview = $derived(router.route.path === "/courses/:courseCode" || router.route.path === "/courses/:courseCode/terms/:termId");
    const termOptions = $derived([
        { value: "", label: "课程公共页" },
        ...(result.data?.viewer === session.user?.id ? result.data?.myTerms ?? [] : []).map(term => ({ value: term.id, label: `${term.name}${term.current ? "（本学期）" : ""}` })),
        ...(result.data?.term && !result.data.myTerms.some(term => term.id === result.data?.term?.id)
            ? [{ value: result.data.term.id, label: result.data.term.name }] : [])
    ]);
    function changeTerm(termId: string) {
        const course = result.data?.course;
        if (course) void navigate(`/courses/${encodeURIComponent(course.id)}${termId ? `/terms/${encodeURIComponent(termId)}` : ""}`);
    }

</script>

<PageLayout title={result.data?.course.name ?? "课程"}>
    {#snippet heading()}
        <CourseNav courseCode={result.data?.course.id ?? courseCode} courseName={result.data?.course.name ?? "课程"}
            showBack={!courseOverview} loading={result.status === "loading"}
            manageHref={result.data && result.data.viewer === session.user?.id && result.data.permissions.canManageContent ? courseManageHref(result.data.course, session.user) : undefined}>
            {#snippet actions()}
                {#if courseOverview && result.data && (session.user?.role === "student" || session.user?.role === "teacher" || result.data.term)}
                    <div class="term-navigation">
                        <Field label={session.user?.role === "student" ? "修读学期" : session.user?.role === "teacher" ? "授课学期" : "课程学期"}
                            help={!result.data.term && termOptions.length < 2 && result.data.viewer === session.user?.id ? `暂无${session.user?.role === "teacher" ? "授课" : "修读"}记录` : undefined}>
                            {#snippet children({ id, describedBy })}<Select {id} fitOptions aria-describedby={describedBy} value={result.data?.term?.id ?? ""} options={termOptions}
                                disabled={termOptions.length < 2} onchange={event => changeTerm(event.currentTarget.value)} />{/snippet}
                        </Field>
                    </div>
                {/if}
            {/snippet}
        </CourseNav>
    {/snippet}
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {@render children()}
    </ResourceState>
</PageLayout>

<style>
    .term-navigation { width: max-content; max-width: 100%; }
    .term-navigation :global(.field) { grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--space-3); }
    .term-navigation :global(.help) { grid-column: 1 / -1; text-align: end; }
</style>