export function isAppUrl(url: URL, origin: string): boolean {
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }
    return url.origin === origin && !pathname.startsWith("/api") && !/\.[^/]+$/.test(pathname);
}

export function safeNext(next: string | null | undefined, origin = window.location.origin): string {
    if (!next?.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n\t]/.test(next)) return "/";
    try {
        const url = new URL(next, origin);
        if (url.origin !== origin || decodeURIComponent(url.pathname).startsWith("/api")) return "/";
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return "/";
    }
}

export function loginDestination(next: string | null): string {
    const target = safeNext(next);
    const path = new URL(target, window.location.origin).pathname.replace(/\/+$/, "");
    return path === "/login" || path === "/admin/login" ? "/" : target;
}

export function loginHref(next: string): string {
    return `/login?${new URLSearchParams({ next: safeNext(next) })}`;
}