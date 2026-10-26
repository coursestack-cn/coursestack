# 页面接入约定

页面地址以 [前端路由](../../../docs/组员2-前端路由.md) 为准。新增地址先登记文档，再在 `src/lib/router/routes.ts` 中登记路径、动态导入、登录要求和标题。页面放入相应模块目录，命名为 `<Name>Page.svelte`。`/admin` 与 `/admin/*` 暂时共用管理端占位页。

## 页面属性与布局

- 页面接收 `PageProps` 中的 `params: Record<string, string>`。参数已按路径段解码，业务 ID 仍按不透明字符串处理；拼接链接和 API 路径时使用 `encodeURIComponent`。
- 页面根节点使用 `PageLayout`，它提供必需的 `h1`、可选 `subtitle`、`breadcrumbs`、`actions` snippet 和 `width="page" | "prose"`。不要再嵌套 `main` 或另建全局 Toaster。
- 课程内页面使用 `CourseNav`，传入接口返回的 `courseName`、`courseId`。仅在接口确认有管理权限时传入 `showManage`，组件自身不请求数据。
- 当前 `PagePlaceholder` 为占位页复用布局、空状态及参数展示。实现业务页时用该页自己的 `PageLayout` 和内容替换它。
- 路径变化时页面重新挂载；只变更查询参数或锚点时保留页面实例。

```svelte
<script lang="ts">
    import PageLayout from "$lib/components/shell/PageLayout.svelte";
    import { router } from "$lib/router/router.svelte.js";
    import type { PageProps } from "$lib/router/types";

    let { params }: PageProps = $props();
    const sort = $derived(router.query.get("sort") ?? "active");
</script>

<PageLayout title="页面标题">
    <!-- 在这里实现页面内容；params 与 sort 均随路由变化。 -->
</PageLayout>
```

## 请求与页面状态

`api` 位于 `src/lib/api/client.ts`，仅接受 `/api/...` 相对地址，自动使用同源 Cookie。`get<T>(path, options?)`；其余 `post/put/patch/delete<T>(path, body?, options?)`。JSON 请求体自动序列化。`options` 支持 `signal`、`headers` 和 `rawBody`；传原始请求体时将 `body` 设为 `undefined`，按接口约定提供 Content-Type。不要同时传 JSON 和原始请求体。

成功返回响应中的 `data`；204 或正文为空（包括只有空白）的成功响应返回 `undefined`，无返回值的接口使用 `api.post<void>` 等类型。失败统一抛出 `ApiError`，含 `status`、`code`、`message`，其中 message 只用于调试。网络失败为 `0 / NETWORK_ERROR`，主动取消为 `0 / ABORTED`。请求不自动重试，也不自行跳页。

组件初始化时调用 `resource<T>((signal) => Promise<T>)`，从 `src/lib/api/resource.svelte.js` 引入。返回响应式 `status`、`data`、`error`、只读 `refreshing` 和 `reload()`。加载函数在第一个 `await` 前读取 `params` 或 `router.query`；Svelte 会跟踪这些依赖，变化时取消旧请求并重载。把 `signal` 传给 API 请求；组件销毁时同样取消，已过期的结果不会覆盖新数据。

首次加载为 `loading`。已有成功结果后重载时保留旧数据，`status` 仍为 `ready`、`refreshing` 为 `true`；成功后替换数据并结束刷新，失败则清空数据、结束刷新并进入 `error`，不让旧条件的结果冒充新条件的结果。路径变化重新挂载页面时，从首次加载开始。

```svelte
<ResourceState status={result.status} error={result.error} refreshing={result.refreshing} reload={result.reload}>
    {#if result.data}
        <!-- 成功内容 -->
    {/if}
</ResourceState>
```

`ResourceState` 延迟 200ms 展示首次加载状态；刷新时保留内容，设置 `aria-busy` 并在内容上方显示细进度条，不遮挡内容或改变布局。它将 401、403、404 映射为登录要求、无权限、页面未找到，其他错误通过 `userMessage` 展示前端文案与重试。401 的登录链接自动带回当前地址。下架内容的状态码和业务错误码尚未确定，暂不按猜测映射为 `unavailable`。

## 导航与页面标题

从 `src/lib/router/router.svelte.js` 引入：

- `router.route / params / query / hash / pathname / href / navigationId`：响应式当前地址信息。`hash` 保留开头的 `#`；`href` 包含路径、查询与锚点。将 `query` 视为只读，不直接调用它的 `set/delete`。
- `navigate(href, { replace?, scroll?: "top" })`：站内导航，返回 `Promise<boolean>`；取消离开时返回 `false`。
- `updateQuery(changes, { replace?, scroll?: "top" })`：保留路径与锚点，只更新指定查询参数。`null` 删除键，`undefined` 保留原值，字符串数组保留重复键。
- `setTitle(title)`：设置动态标题，自动附加 ` - 课栈`。在数据就绪后更新，并让 `PageLayout` 的标题与内容保持一致。

导航使用地址表中已登记的地址，不自行拼接未登记页面。优先使用通用组件的 `href`；路由在 `document` 上统一拦截同源链接。Ctrl、Meta、Shift、Alt、中键、新窗口、下载、API 和文件链接继续使用浏览器原生行为。通用组件无需导入路由。

以规范化后的 `pathname` 是否改变区分导航：路径变化才询问未保存内容，新页面回到顶部（带锚点时定位目标），渲染完成后聚焦 `h1`。首次加载不抢焦点。

只改查询参数时保留页面、滚动位置和焦点，不询问离开，也不覆盖动态标题。同页切换锚点时定位并聚焦目标；不可聚焦的目标临时设置 `tabindex="-1"`，焦点移出后移除，已有 tabindex 不改动。查询变化但锚点未变时不会重新定位该锚点。

前进、后退优先恢复目标历史项保存的位置，即使地址含锚点也不覆盖读者最后的滚动位置；只有路径变化才询问离开并聚焦新页 h1，同页历史切换不移动焦点。翻页等场景可调用 `updateQuery({ page: 2 }, { scroll: "top" })` 显式回顶，同页焦点仍保持；显式回顶优先于锚点定位。页面组件加载失败时由路由出口提供整页重新加载操作。

## 错误提示

界面只显示前端维护的文案，不能直接渲染 `ApiError.message` 或把它传给 Toast。请求客户端使用 `console.warn` 输出状态、错误码及后端原文，方便调试；主动取消不记录警告，也不展示给用户。

从 `src/lib/api/errors.ts` 引入 `userMessage(error, overrides?)` 和 `isAborted(error)`。默认文案覆盖网络、400、401、403、404、409、413、429、5xx 及无法识别的响应；未知错误也使用通用提示，不插入后端原文。

```ts
if (!isAborted(error)) {
    toast.error(userMessage(error, {
        CONTENT_CHANGED: "内容已被修改，刷新后重试。",
        429: "尝试次数过多，稍后再试。",
        default: "保存失败，稍后重试。"
    }));
}
```

覆盖优先级为错误码、状态码。`default` 覆盖该场景其余文案，但网络错误继续使用默认网络提示，除非显式覆盖 `NETWORK_ERROR` 或状态 0；`ABORTED` 始终忽略。文案说明发生了什么和怎么办，不用“请”、感叹号及面向用户的技术术语。

今后的建号、重置密码、修改密码等表单应先在前端检查输入，后端错误只作兜底。当前密码规则为至少 8 位、不超过 72 字节；后端调整由组员 1 负责。登录页保留统一的凭据错误文案，不向用户暴露密码规则或具体哪个字段不正确。

## 会话与权限

从 `src/lib/session.svelte.js` 引入 `session`，读取 `status`、`user`，调用 `login(schoolNumber, password, signal?)`、`adminLogin(password, signal?)`、`logout()`、`hasRole(role)`。App 启动时调用一次 `initialize()`。启动请求因网络或服务器错误失败时，身份仍保持待确认，`error` 暴露原因，`retry()` 可重试；不要把连接故障当成已退出登录。

登录态只存在内存和服务端 HttpOnly Cookie 中，不读取或持久化令牌。头像地址为 `/api/profiles/:id/avatar`，编码用户 ID 后传给 `Avatar`，由它负责加载失败时的首字回退。

路由只按 `requiresAuth` 拦截匿名访问。角色仅用于入口展示，资源权限及操作权限仍由服务端验证。登录 `next` 使用 `src/lib/router/urls.ts` 中的 `safeNext()` 校验；登录页使用 `loginDestination()` 同时避免回跳到登录页形成循环。未授权响应会同步会话状态，但请求层不跳转页面。

## 未保存内容

组件初始化时从 `src/lib/router/leave.svelte.js` 引入并调用 `onBeforeLeave(callback)`。回调返回 `true` 表示可以离开，`false` 表示有未保存修改；路由统一使用 `ConfirmDialog` 询问，不在页面中重复创建对话框。注册项在组件销毁时自动清理，也可调用返回的函数提前注销。

```ts
onBeforeLeave(() => !dirty);
```

改变路径的站内链接、程序导航和前进后退均经过确认；同页查询或锚点变化保留草稿，不询问。关闭标签页、刷新和离开站点使用浏览器原生 `beforeunload` 提示，其文案和展示条件由浏览器控制。会话失效时的登录重定向立即生效。编辑问题占位页演示了这套机制，文本不会保存或提交。