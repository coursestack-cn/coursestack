import { tick } from "svelte";
import { routes, notFoundRoute } from "$lib/router/routes";
import { matchRoute, normalizePath } from "$lib/router/match";
import { confirmLeave, hasUnsavedChanges } from "$lib/router/leave.svelte.js";
import { isAppUrl } from "$lib/router/urls";
import { normalizeContentHash } from "$lib/router/ids";

type ScrollPosition = { x: number; y: number };
type Entry = { index: number; scroll: ScrollPosition };
type NavigationKind = "initial" | "push" | "replace" | "pop";
export type NavigationOptions = { replace?: boolean; scroll?: "top" };
export type QueryChanges = Record<string, string | number | boolean | readonly string[] | null | undefined>;

const stateKey = "coursestack";
const zeroScroll = () => ({ x: 0, y: 0 });
let entry: Entry = { index: 0, scroll: zeroScroll() };
let kind: NavigationKind = "initial";
let pathChanged = false;
let hashChanged = false;
let scrollToTop = false;
let authRedirectDeferrals = $state(0);
let renderPending = true;
let started = false;
let navigating = false;
let popPending = false;
let restored: (() => void) | undefined;
let approvedPop: number | undefined;
let completed = -1;

function readLocation(id: number) {
    const url = new URL(window.location.href);
    const match = matchRoute(url.pathname, routes);
    return {
        id,
        href: `${url.pathname}${url.search}${url.hash}`,
        pathname: url.pathname,
        query: new URLSearchParams(url.search),
        hash: url.hash,
        route: match?.route ?? notFoundRoute,
        params: match?.params ?? {}
    };
}

let current = $state.raw(readLocation(0));

export const router = {
    get route() { return current.route; },
    get params() { return current.params; },
    get query() { return current.query; },
    get hash() { return current.hash; },
    get pathname() { return current.pathname; },
    get href() { return current.href; },
    get navigationId() { return current.id; },
    get authRedirectDeferred() { return authRedirectDeferrals > 0; }
};

// Let an explicit logout choose its destination before the anonymous-route guard runs.
export function deferAuthRedirects(): () => void {
    authRedirectDeferrals++;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        authRedirectDeferrals--;
    };
}

export function setTitle(title: string): void {
    document.title = `${title} - 课栈`;
}

function readEntry(): Entry | undefined {
    const value = window.history.state?.[stateKey];
    return value && Number.isInteger(value.index) && Number.isFinite(value.scroll?.x)
        && Number.isFinite(value.scroll?.y) ? value : undefined;
}

function writeEntry(value: Entry, href?: string): void {
    window.history.replaceState({ ...window.history.state, [stateKey]: value }, "", href);
}

function saveScroll(): void {
    if (renderPending || popPending || readEntry()?.index !== entry.index) return;
    entry = { ...entry, scroll: { x: window.scrollX, y: window.scrollY } };
    writeEntry(entry);
}

function normalizeLocation(): void {
    const url = new URL(window.location.href);
    const pathname = normalizePath(url.pathname);
    const hash = normalizeContentHash(url.hash);
    if (pathname !== url.pathname || hash !== url.hash) {
        window.history.replaceState(window.history.state, "", `${pathname}${url.search}${hash}`);
    }
}

function publish(nextKind: NavigationKind, top = false): void {
    normalizeLocation();
    const previous = current;
    kind = nextKind;
    scrollToTop = top;
    renderPending = true;
    current = readLocation(current.id + 1);
    pathChanged = previous.pathname !== current.pathname;
    hashChanged = previous.hash !== current.hash;
    if (pathChanged) setTitle(current.route.title);
}

function commit(url: URL, options: NavigationOptions = {}, automatic = false): void {
    saveScroll();
    const pathname = normalizePath(url.pathname);
    const scroll = pathname === current.pathname && options.scroll !== "top"
        ? { x: window.scrollX, y: window.scrollY } : zeroScroll();
    entry = { index: entry.index + (options.replace ? 0 : 1), scroll };
    const href = `${pathname}${url.search}${normalizeContentHash(url.hash)}`;
    if (options.replace) writeEntry(entry, href);
    else window.history.pushState({ [stateKey]: entry }, "", href);
    publish(automatic && kind === "initial" && completed < 0 ? "initial" : options.replace ? "replace" : "push", options.scroll === "top");
}

export async function navigate(href: string, options: NavigationOptions = {}): Promise<boolean> {
    const url = new URL(href, window.location.href);
    if (!isAppUrl(url, window.location.origin)) {
        // Native navigation retains browser beforeunload protection for external pages/files.
        if (options.replace) window.location.replace(url.href);
        else window.location.assign(url.href);
        return true;
    }
    url.pathname = normalizePath(url.pathname);
    url.hash = normalizeContentHash(url.hash);
    if (navigating || popPending) return false;
    if (`${url.pathname}${url.search}${url.hash}` === current.href) {
        if (options.scroll === "top") window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        else if (url.hash) {
            const target = anchorTarget(url.hash);
            if (target) { target.scrollIntoView({ behavior: "instant", block: "start" }); focusAnchor(target); }
        }
        saveScroll();
        return true;
    }
    navigating = true;
    try {
        if (!await confirmLeave(url.pathname === current.pathname)) return false;
        commit(url, options);
        return true;
    } finally {
        navigating = false;
    }
}

// Authentication redirects must not leave a protected page visible after session expiry.
export function redirect(href: string): void {
    const url = new URL(href, window.location.origin);
    if (!isAppUrl(url, window.location.origin)) {
        window.location.replace(url.href);
        return;
    }
    if (`${url.pathname}${url.search}${url.hash}` !== current.href) commit(url, { replace: true }, true);
}

export function updateQuery(changes: QueryChanges, options: NavigationOptions = {}): Promise<boolean> {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) continue;
        url.searchParams.delete(key);
        if (value === null) continue;
        if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
        else url.searchParams.set(key, String(value));
    }
    return navigate(`${url.pathname}${url.search}${url.hash}`, options);
}

async function popstate(): Promise<void> {
    const target = readEntry() ?? { index: entry.index - 1, scroll: zeroScroll() };
    if (restored && target.index === entry.index) {
        const resolve = restored;
        restored = undefined;
        resolve();
        return;
    }
    if (approvedPop === target.index) {
        approvedPop = undefined;
        popPending = false;
        entry = target;
        publish("pop");
        return;
    }
    if (popPending) {
        if (target.index !== entry.index) window.history.go(entry.index - target.index);
        return;
    }
    const delta = target.index - entry.index;
    const samePage = normalizePath(window.location.pathname) === current.pathname;
    if (delta && hasUnsavedChanges(samePage)) {
        // Restore the current entry before asking; cancellation preserves the forward stack.
        popPending = true;
        await new Promise<void>((resolve) => {
            restored = resolve;
            window.history.go(-delta);
        });
        if (await confirmLeave(samePage)) {
            approvedPop = target.index;
            window.history.go(delta);
        } else {
            popPending = false;
        }
        return;
    }
    entry = target;
    writeEntry(entry);
    publish("pop");
}

export function shouldInterceptLink(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
    if (!anchor.hasAttribute("href") || anchor.hasAttribute("download")) return false;
    const target = anchor.getAttribute("target");
    if (target && target.toLowerCase() !== "_self") return false;
    return isAppUrl(new URL(anchor.href), window.location.origin);
}

function click(event: MouseEvent): void {
    const anchor = event.composedPath().find((element) => element instanceof HTMLAnchorElement);
    if (!(anchor instanceof HTMLAnchorElement) || !shouldInterceptLink(event, anchor)) return;
    event.preventDefault();
    void navigate(anchor.href);
}

function anchorTarget(hash: string): HTMLElement | null {
    try {
        const name = decodeURIComponent(hash.slice(1));
        return document.getElementById(name) ?? (document.getElementsByName(name)[0] as HTMLElement | undefined) ?? null;
    } catch {
        return null;
    }
}

function focusAnchor(target: HTMLElement): void {
    target.focus({ preventScroll: true });
    if (document.activeElement === target || target.hasAttribute("tabindex")) return;
    target.setAttribute("tabindex", "-1");
    const cleanup = () => {
        if (target.getAttribute("tabindex") === "-1") target.removeAttribute("tabindex");
        target.removeEventListener("blur", cleanup);
    };
    target.addEventListener("blur", cleanup, { once: true });
    target.focus({ preventScroll: true });
    if (document.activeElement !== target) cleanup();
}

export async function finishNavigation(id: number): Promise<void> {
    await tick();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (id !== current.id || completed === id) return;
    completed = id;
    if (kind !== "initial" && pathChanged) document.querySelector<HTMLElement>("#main h1")?.focus({ preventScroll: true });
    // Restore history positions even with fragments; query-only changes must not re-focus an unchanged fragment.
    const useAnchor = kind !== "pop" && !scrollToTop && current.hash && (kind === "initial" || pathChanged || hashChanged);
    const target = useAnchor ? anchorTarget(current.hash) : null;
    if (target) {
        target.scrollIntoView({ behavior: "instant", block: "start" });
        if (kind !== "initial" && !pathChanged) focusAnchor(target);
    } else {
        const position = scrollToTop ? zeroScroll() : entry.scroll;
        window.scrollTo({ left: position.x, top: position.y, behavior: "instant" });
    }
    renderPending = false;
    saveScroll();
}

export function startRouter(): () => void {
    if (started) return () => {};
    started = true;
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    entry = readEntry() ?? { index: 0, scroll: { x: window.scrollX, y: window.scrollY } };
    writeEntry(entry);
    normalizeLocation();
    current = readLocation(current.id);
    setTitle(current.route.title);
    const unload = (event: BeforeUnloadEvent) => {
        saveScroll();
        if (!hasUnsavedChanges()) return;
        event.preventDefault();
        event.returnValue = "";
    };
    document.addEventListener("click", click);
    window.addEventListener("popstate", popstate);
    window.addEventListener("scroll", saveScroll, { passive: true });
    window.addEventListener("pagehide", saveScroll);
    window.addEventListener("beforeunload", unload);
    return () => {
        saveScroll();
        document.removeEventListener("click", click);
        window.removeEventListener("popstate", popstate);
        window.removeEventListener("scroll", saveScroll);
        window.removeEventListener("pagehide", saveScroll);
        window.removeEventListener("beforeunload", unload);
        window.history.scrollRestoration = previousRestoration;
        started = false;
    };
}