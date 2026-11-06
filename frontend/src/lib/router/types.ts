import type { Component } from "svelte";

export type PageProps = { params: Record<string, string> };
export type Route = {
    path: string;
    load: () => Promise<{ default: Component<PageProps> }>;
    requiresAuth: boolean;
    title: string;
    /** The page names its heading and breadcrumb from loaded data, so the router shows placeholders instead of `title` while the page loads. */
    dynamicHeading?: boolean;
    layout?: "course";
};