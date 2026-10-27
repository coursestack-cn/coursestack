import type { Component } from "svelte";

export type PageProps = { params: Record<string, string> };
export type Route = {
    path: string;
    load: () => Promise<{ default: Component<PageProps> }>;
    requiresAuth: boolean;
    title: string;
};