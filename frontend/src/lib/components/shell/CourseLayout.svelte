<script module lang="ts">
    import { getContext, setContext, type Snippet } from "svelte";
    import type { Resource } from "$lib/api/resource.svelte.js";

    type CourseEntry = {
        course: import("../../../pages/manage/course").Course;
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
    import CourseNav from "$lib/components/shell/CourseNav.svelte";
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import ResourceState from "$lib/components/shell/ResourceState.svelte";

    let { courseCode, children }: { courseCode: string; children: Snippet } = $props();
    const result = resource(async (signal) => {
        const code = courseCode, viewer = session.user?.id;
        if (!code.trim() || code.trim().length > 40) throw new ApiError(404, "COURSE_NOT_FOUND", "课程不存在");
        const entry = await api.get<Omit<CourseEntry, "viewer">>(`/api/courses/${encodeURIComponent(code)}/entry`, { signal });
        return { ...entry, viewer };
    });
    setContext(courseContext, result);
</script>

<PageLayout title={result.data?.course.name ?? "课程"}>
    {#snippet heading()}
        <CourseNav courseCode={result.data?.course.id ?? courseCode} courseName={result.data?.course.name ?? "课程"}
            loading={result.status === "loading"}
            showManage={result.data?.viewer === session.user?.id && result.data?.permissions.canManageContent} />
    {/snippet}
    <ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
        {@render children()}
    </ResourceState>
</PageLayout>