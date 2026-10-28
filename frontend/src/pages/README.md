# 页面接入约定

页面地址以 [前端路由](../../../docs/前端路由.md) 为准。新增地址先登记文档，再在 `src/lib/router/routes.ts` 中登记路径、动态导入、登录要求和标题。页面放入相应模块目录，命名为 `<Name>Page.svelte`。管理端页面放在 `pages/admin/`，页面内容顶部使用同目录的 `AdminNav` 切换账号管理与课程管理；未实现的 `/admin/*` 暂时共用管理端占位页。

## 页面属性与布局

- 页面接收 `PageProps` 中的 `params: Record<string, string>`。参数已按路径段解码；课程页面使用 `params.courseCode`，其他业务 ID 仍按不透明字符串处理。拼接链接和 API 路径时使用 `encodeURIComponent`。
- 普通页面根节点使用 `PageLayout`，它提供必需的 `h1`、可选 `subtitle`、`breadcrumbs`、`actions` snippet 和 `width="page" | "prose"`。可用 `heading` snippet 替换默认标题区，但须提供一个 `h1`。不要再嵌套 `main` 或另建全局 Toaster。
- 课程主页、资料、问答和现有课程管理页在路由中声明 `layout: "course"`，由路由出口提供 `CourseLayout` 和 `CourseNav`。这些页面只渲染正文，不再嵌套 `PageLayout` 或重复查询课程信息；初始化时通过 `CourseLayout.svelte` 导出的 `getCourse()` 读取共享的课程资源。独立的提问表单仍使用自己的布局。课程名称作为唯一 `h1` 显示，管理入口只依据当前用户的服务端权限。
- 当前 `PagePlaceholder` 为占位页复用布局及空状态；处于课程布局内时只显示正文占位。实现业务页时按所属布局替换它。
- 首页在会话确认后按登录态切换：未登录复用 `CourseListPage`，已登录使用 `MyCoursesPage` 展示本人的课程，按账号 ID 重新挂载以隔离不同账号的数据。首页通过 `setTitle()` 更新浏览器标题；动态尚未接入。
- 路径变化时正文页面重新挂载；同一课程的 tab 切换保留课程布局、导航节点与课程数据，只有首次进入或更换课程时显示导航骨架。只变更查询参数或锚点时保留页面实例。

`CourseListPage` 通过 `GET /api/courses` 获取课程，每页 12 门，使用 `q` 和 `page` 保存搜索与分页状态，按接口提供的创建时间倒序显示。卡片使用 `currentTeacher` 展示本学期教师的公开昵称；为空时显示“本学期未开课”，不据此推导管理权限。请求通过 `resource` 取消过期加载并保留刷新中的旧结果；页面覆盖空课程、搜索无结果、失败重试与页码超界回退。教师和管理员的新建入口只负责导航，创建权限由对应接口校验。

`MyCoursesPage` 通过 `GET /api/me/courses` 获取本人修读或授课的课程，首页 `tab=current|history` 对应接口 `scope`，默认本学期，每页 12 门，按课程编号排序。切换分类重置页码，历史记录按课程去重并展示本人参与的学期；课程卡片继续用编号导航。空课程、当前学期未设置和请求失败分别反馈，管理员不自动获得全部课程作为“我的课程”。关注课程及动态暂不显示，不请求动态接口。

课程页面地址使用唯一课程编号，例如 `/courses/MATH101`；`CourseLayout` 通过 `GET /api/courses?code=MATH101&pageSize=1` 定位课程，再读取 `/api/courses/:id/entry` 获取课程信息和管理权限。同一课程的 tab 切换不重复这两个请求，问答筛选仅重载问题列表；当前用户变化时刷新课程资源，离开课程布局后释放资源。`code` 是独立于模糊搜索 `q` 的可选过滤条件，不改变原列表响应结构；课程写入和讨论接口继续使用返回的内部 `id`。修改课程编号后，页面地址随之改变。

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

`ResourceState` 延迟 200ms 展示首次加载状态；刷新时保留内容，设置 `aria-busy` 并在内容上方显示细进度条，不遮挡内容或改变布局。它将 401、403、404 映射为登录要求、无权限、页面未找到，其他错误通过 `userMessage` 展示前端文案与重试。401 的登录链接自动带回当前地址。问答页面通过模块内的 `ContentState` 将 `404 CONTENT_UNAVAILABLE` 映射为不可用状态；普通未知地址仍显示 404。

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
        STATE_CONFLICT: "内容状态已变化，刷新后重试。",
        429: "尝试次数过多，请稍后再试。",
        default: "保存失败，请稍后重试。"
    }));
}
```

覆盖优先级为错误码、状态码。`default` 覆盖该场景其余文案，但网络错误继续使用默认网络提示，除非显式覆盖 `NETWORK_ERROR` 或状态 0；`ABORTED` 始终忽略。文案说明发生了什么和怎么办，不用“请”、感叹号及面向用户的技术术语。

今后的建号、重置密码、修改密码等表单应先在前端检查输入，后端错误只作兜底。当前密码规则为至少 8 位、不超过 72 字节；后端调整由组员 1 负责。登录页保留统一的凭据错误文案，不向用户暴露密码规则或具体哪个字段不正确。

## 会话与权限

从 `src/lib/session.svelte.js` 引入 `session`，读取 `status`、`user`，调用 `login(schoolNumber, password, signal?)`、`adminLogin(password, signal?)`、`logout()`、`hasRole(role)`。App 启动时调用一次 `initialize()`。启动请求因网络或服务器错误失败时，身份仍保持待确认，`error` 暴露原因，`retry()` 可重试；不要把连接故障当成已退出登录。

个人设置通过 `GET /api/me/profile` 读取本人资料，身份、学工号、姓名、院系、专业、年级和最近登录时间只读展示。`session.changeNickname(nickname, signal?)` 只向 `PATCH /api/me/profile` 提交昵称，保存成功后同步当前会话中的昵称；完整学籍资料只保留在设置页。昵称去首尾空白，最多 80 个字符，留空保存为 null；未保存修改由统一离开确认保护。修改密码继续进入 `/settings/password`，成功后注销全部会话。

登录态只存在内存和服务端 HttpOnly Cookie 中，不读取或持久化令牌。头像地址为 `/api/profiles/:id/avatar`，编码用户 ID 后传给 `Avatar`，由它负责加载失败时的首字回退。

路由只按 `requiresAuth` 拦截匿名访问。角色仅用于入口展示，资源权限及操作权限仍由服务端验证。登录 `next` 使用 `src/lib/router/urls.ts` 中的 `safeNext()` 校验；登录页使用 `loginDestination()` 同时避免回跳到登录页形成循环。未授权响应会同步会话状态，但请求层不跳转页面。

## 未保存内容

组件初始化时从 `src/lib/router/leave.svelte.js` 引入并调用 `onBeforeLeave(callback)`。回调返回 `true` 表示可以离开，`false` 表示有未保存修改；路由统一使用 `ConfirmDialog` 询问，不在页面中重复创建对话框。注册项在组件销毁时自动清理，也可调用返回的函数提前注销。

```ts
onBeforeLeave(() => !dirty);
```

改变路径的站内链接、程序导航和前进后退均经过确认；同页查询或锚点变化保留草稿，不询问。关闭标签页、刷新和离开站点使用浏览器原生 `beforeunload` 提示，其文案和展示条件由浏览器控制。会话失效时的登录重定向立即生效。问答发布和编辑表单已接入真实保存。位于回答分页内的编辑和评论表单使用 `onBeforeLeave(callback, { samePage: true })`，在查询参数或锚点变化可能替换分页内容时也确认未保存修改；其他页面保持默认只检查路径变化。评论区收起后仍保留其表单。

## 问答接入

`pages/questions/` 的 `data.ts` 定义 DTO 适配、权限视图、分页定位和创建请求的幂等键。相同提交失败后重试复用键，改变请求内容或账号则更换；成功后清空表单。组件中的能力开关只控制入口，服务端继续授权。

页面 URL 的 UUID 使用 32 位无横杠格式，生成路径和锚点时用 `lib/router/ids.ts` 的 `urlId`。路由匹配将 ID 参数转换回接口格式；手动解析锚点时用 `entityId`。内容视图的 DOM ID 同样使用无横杠格式，接口请求与业务比较继续使用 DTO 中的原始 ID。旧 URL 的规范化保留查询与锚点，不修改正文保存的历史链接。

课程问答从共享课程布局取得内部 id，再请求问答接口；详情页按当前课程入口的 canManage 控制采纳与下架。普通提问者不能采纳。问题评论与回答评论分别加载，删除评论保留有回复的占位。

回答和评论锚点在内容加载后定位，目标不在首页时分页查找，取消旧请求；父级链由 /api/contents/:id 逐级读取。当前接口没有直接返回目标排名，长讨论的深分页定位会产生多次只读请求。资料页仍为占位，中转可生成资料锚点但需资料页后续接入。

正文校验使用 shared/rich-text，编辑器绑定值为 null 或 onstatechange.valid=false 时不可提交。表单拒绝空白正文；正文图片上传尚未接入，链接、公式与代码可用。资料、搜索、通知和课程管理页面不在此次问答实现范围内。