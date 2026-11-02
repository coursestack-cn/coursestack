<script lang="ts">
    import { type PageProps } from "$lib/router/types";
    import CourseContentRedirect from "../courses/CourseContentRedirect.svelte";
    let { params }: PageProps = $props();
</script>

<CourseContentRedirect courseCode={params.courseCode!} kind="question" />