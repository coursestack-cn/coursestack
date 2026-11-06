<script lang="ts">
    import { api } from "$lib/api/client";
    import { resource } from "$lib/api/resource.svelte";
    import { beginNotificationCount, notificationUpdates, publishNotificationCount } from "$lib/notifications.svelte";
    import { onMount } from "svelte";
    import { Bell, Search, SunMoon, ChevronDown } from "@lucide/svelte";
    import logoSource from "../../../assets/coursestack-logo.svg?raw";
    import { sm } from "../../../styles/breakpoints";
    import Button from "$lib/components/ui/Button.svelte";
    import Link from "$lib/components/ui/Link.svelte";
    import Menu, { type MenuItem } from "$lib/components/ui/Menu.svelte";
    import SearchInput from "$lib/components/ui/SearchInput.svelte";
    import Avatar from "$lib/components/ui/Avatar.svelte";
    import Skeleton from "$lib/components/ui/Skeleton.svelte";
    import { toast } from "$lib/components/ui/toast.svelte.js";
    import { isAborted, userMessage } from "$lib/api/errors";
    import { session } from "$lib/session.svelte.js";
    import { router, navigate, redirect, deferAuthRedirects } from "$lib/router/router.svelte.js";
    import { confirmLeave } from "$lib/router/leave.svelte.js";
    import { loginHref } from "$lib/router/urls";
    import { getThemePreference, setThemePreference, type ThemePreference } from "$lib/theme";

    // The trusted repository SVG keeps the existing book geometry and follows the surface theme.
    const logo = logoSource.replaceAll("coursestack-book", "shell-book")
        .replaceAll('"#111"', '"currentColor"').replaceAll('"#fff"', '"var(--color-surface)"');
    let theme = $state<ThemePreference>(getThemePreference());
    let narrow = $state(window.matchMedia(`(max-width: ${sm - 1}px)`).matches);
    let search = $state("");
    let loggingOut = $state(false);
    const notifications = resource(async signal => {
        const viewer = session.user?.id;
        notificationUpdates.revision;
        const onNotifications = router.pathname === "/notifications";
        if (!viewer || onNotifications) return;
        const request = beginNotificationCount();
        const data = await api.get<{ viewer: string; unreadCount: number }>("/api/notifications/count", { signal });
        if (!signal.aborted && data.viewer === viewer && session.user?.id === viewer) publishNotificationCount(viewer, data.unreadCount, request);
    });
    const unreadCount = $derived(notificationUpdates.viewer === session.user?.id ? notificationUpdates.unreadCount : 0);
    const inCourses = $derived(router.pathname === "/courses");
    const themeOptions: { value: ThemePreference; label: string }[] = [
        { value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }
    ];
    const themeItems = $derived(themeOptions.map((option) => ({
        label: option.label,
        checked: theme === option.value,
        onselect: () => { theme = option.value; setThemePreference(theme); }
    })));
    const courseItem = $derived({ label: "全部课程", href: "/courses", current: inCourses });
    const userItems = $derived.by(() => {
        const items: MenuItem[] = [
            ...(narrow ? [courseItem, { type: "separator" as const }] : []),
            { label: "我的收藏", href: "/me/favorites" },
            { label: "个人设置", href: "/settings" }
        ];
        if (session.hasRole("teacher")) items.push({ label: "管理课程", href: "/manage/courses" });
        if (session.hasRole("admin")) items.push({ label: "管理端", href: "/manage/accounts" });
        items.push({ type: "separator" }, { label: loggingOut ? "正在退出…" : "退出登录", disabled: loggingOut, onselect: () => { void logout(); } });
        return items;
    });

    async function logout() {
        if (loggingOut) return;
        if (router.route.requiresAuth && !await confirmLeave()) return;
        loggingOut = true;
        const resumeAuthRedirects = deferAuthRedirects();
        try {
            await session.logout();
            if (router.route.requiresAuth) redirect("/");
        } catch (error) {
            if (!isAborted(error)) toast.error(userMessage(error));
        } finally {
            resumeAuthRedirects();
            loggingOut = false;
        }
    }

    $effect(() => { search = router.pathname === "/search" ? router.query.get("q") ?? "" : ""; });

    onMount(() => {
        const media = window.matchMedia(`(max-width: ${sm - 1}px)`);
        const resize = () => { narrow = media.matches; };
        const storage = () => { theme = getThemePreference(); setThemePreference(theme); };
        media.addEventListener("change", resize);
        window.addEventListener("storage", storage);
        const refresh = () => { if (session.user && router.pathname !== "/notifications" && document.visibilityState === "visible") notifications.reload(); };
        const interval = window.setInterval(refresh, 60000);
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            media.removeEventListener("change", resize);
            window.removeEventListener("storage", storage);
            window.clearInterval(interval);
            window.removeEventListener("focus", refresh);
            window.removeEventListener("online", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    });
</script>

<header class="app-header">
    <div class="header-inner">
        <div class="brand-navigation">
            <Link href="/" class="shell-brand" aria-label="课栈首页">
                <span class="logo" aria-hidden="true">{@html logo}</span><span>课栈</span>
            </Link>
            {#if session.status === "authenticated"}
                <nav class="desktop-navigation" aria-label="主导航">
                    <Link href="/courses" class="shell-nav-link" aria-current={inCourses ? "page" : undefined}>全部课程</Link>
                </nav>
            {/if}
        </div>
        <div class="desktop-search" role="search" aria-label="站内搜索">
            <SearchInput bind:value={search} aria-label="搜索课程、资料、问题和回答" placeholder="搜索课程、资料、问题和回答"
                onsubmit={(value) => { void navigate(`/search?${new URLSearchParams({ q: value.trim() })}`); }} />
        </div>
        <div class="header-actions">
            {#if narrow}<Button href="/search" variant="ghost" iconOnly aria-label="搜索"><Search size="1em" /></Button>{/if}
            <Menu items={themeItems}>
                {#snippet trigger(props)}
                    <Button {...props} variant="ghost" iconOnly aria-label="切换主题"><SunMoon size="1em" /></Button>
                {/snippet}
            </Menu>
            {#if session.status === "loading"}
                {#if session.error}
                    <Button size="sm" onclick={() => { void session.retry(); }}>重试会话</Button>
                {:else}<span class="session-loading" role="status" aria-label="正在读取登录状态"><Skeleton variant="circle" width="var(--space-8)" height="var(--space-8)" /></span>{/if}
            {:else if session.user}
                <Button href="/notifications" variant="ghost" iconOnly aria-label={unreadCount > 0 ? `查看通知，${unreadCount} 条未读` : "查看通知"}><Bell size="1em" />{#if unreadCount > 0}<span class="unread-count" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>{/if}</Button>
                <Menu items={userItems}>
                    {#snippet trigger(props)}
                        <Button {...props} variant="ghost" class="shell-user-trigger" aria-label={`${session.user?.nickname ?? "未设置昵称"}的用户菜单`}>
                            <Avatar accountId={session.user?.id} name={session.user?.nickname ?? ""} src={`/api/profiles/${encodeURIComponent(session.user?.id ?? "")}/avatar`} size="sm" />
                            <span class="user-name">{session.user?.nickname ?? "未设置昵称"}</span><span class="user-chevron"><ChevronDown size="1em" /></span>
                        </Button>
                    {/snippet}
                </Menu>
            {:else}
                <Button href={loginHref(router.href)}>登录</Button>
            {/if}
        </div>
    </div>
</header>

<style>
    :global(html) { scroll-padding-top: calc(var(--space-8) * 2 + 1px); }
    .app-header { position: sticky; top: 0; z-index: var(--z-sticky); border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
    .header-inner { width: 100%; max-width: var(--width-page); min-width: 0; min-height: calc(var(--space-8) * 2); margin-inline: auto; padding: var(--space-3) var(--space-6); display: flex; align-items: center; gap: var(--space-6); }
    .brand-navigation { display: flex; align-items: center; gap: var(--space-6); flex-shrink: 0; }
    :global(.shell-brand) { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--color-text); font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); white-space: nowrap; border-radius: var(--radius-sm); }
    :global(.shell-brand:hover) { color: var(--color-accent); text-decoration: none; }
    .logo { display: flex; color: var(--color-accent); }
    .logo :global(svg) { width: var(--space-8); height: var(--space-8); }
    :global(.shell-nav-link) { display: block; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); color: var(--color-text-secondary); font-size: var(--font-size-md); }
    :global(.shell-nav-link:hover) { color: var(--color-accent); background: var(--color-surface-sunken); text-decoration: none; }
    :global(.shell-nav-link[aria-current="page"]), :global(.shell-nav-link:active) { color: var(--color-accent-soft-text); background: var(--color-accent-soft); }
    .desktop-search { flex: 1; min-width: 0; max-width: calc(var(--width-prose) / 2); margin-inline: auto; }
    .header-actions { display: flex; align-items: center; gap: var(--space-2); margin-inline-start: auto; flex-shrink: 0; }
    .unread-count { position: absolute; top: 0; right: 0; transform: translate(25%, -25%); min-width: var(--space-4); padding-inline: var(--space-1); border-radius: var(--radius-full); background: var(--color-accent); color: var(--color-on-accent); font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); line-height: var(--line-height-tight); }
    .session-loading { display: flex; align-items: center; justify-content: center; width: var(--space-10); }
    .user-name { max-width: calc(var(--space-12) * 2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-chevron { display: flex; }
    :global(.shell-user-trigger) { padding: var(--space-1) var(--space-2); }
    @media (max-width: 639px) {
        .header-inner { padding: var(--space-3); gap: var(--space-2); }
        .desktop-navigation, .desktop-search, .user-name, .user-chevron { display: none; }
        .header-actions { gap: var(--space-1); }
        :global(.shell-user-trigger) { width: var(--space-10); padding: var(--space-1); }
    }
</style>