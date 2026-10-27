import { untrack } from "svelte";
import { toApiError, type ApiError } from "$lib/api/client";

export type ResourceStatus = "loading" | "ready" | "error";
export type Resource<T> = {
    readonly status: ResourceStatus;
    readonly data: T | undefined;
    readonly error: ApiError | null;
    readonly refreshing: boolean;
    reload: () => void;
};

// Call during component initialization. Read reactive dependencies before the loader's first await.
export function resource<T>(load: (signal: AbortSignal) => Promise<T>): Resource<T> {
    let status = $state<ResourceStatus>("loading");
    let data = $state.raw<T>();
    let error = $state<ApiError | null>(null);
    let refreshing = $state(false);
    let revision = $state(0);

    $effect(() => {
        revision;
        const controller = new AbortController();
        untrack(() => {
            refreshing = status === "ready";
            if (!refreshing) status = "loading";
            error = null;
        });
        const fail = (cause: unknown) => {
            if (controller.signal.aborted) return;
            const failure = toApiError(cause);
            refreshing = false;
            if (failure.code === "ABORTED") return;
            error = failure;
            data = undefined;
            status = "error";
        };
        try {
            // Invoke synchronously so Svelte can track params/query read by the loader.
            void load(controller.signal).then((result) => {
                if (controller.signal.aborted) return;
                data = result;
                status = "ready";
                refreshing = false;
            }, fail);
        } catch (cause) {
            fail(cause);
        }
        return () => controller.abort();
    });

    return {
        get status() { return status; },
        get data() { return data; },
        get error() { return error; },
        get refreshing() { return refreshing; },
        reload() { revision++; }
    };
}