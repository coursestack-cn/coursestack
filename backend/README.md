# CourseStack 后端：组员3

本分支为首次提交的独立本地审阅版本，基于 `7c29bbc`。当前 `main` 已有统一账号、数据库和部署工程，本版本尚未适配，不能直接合并或部署。接入事项见[提交状态](../docs/member3/提交状态.md)。

已实现课程信息、问题/回答/评论、固定文件版本关联、赞踩排序、采纳与课程加分、举报审查、下架恢复，以及搜索、通知和个人空间所需的数据接口。使用 TypeScript、Hono、Drizzle 和 Cloudflare D1。

这是组员3的后端交付。账号管理、授课/修读关系的正式实现归组员1；文件上传下载、搜索引擎和通知存储归组员4；主站界面归组员2。当前共享表使用本地联调契约，不代表已经确认的全组数据库设计。

## 第一次启动

使用 Node `^22.12.0 || >=24.0.0` 和 pnpm `12.5.1`。在仓库根目录打开终端：

```powershell
cd backend
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm db:seed:local
pnpm check
pnpm dev
```

打开 <http://127.0.0.1:8787/> 进入本地功能验收页，可切换学生和教师身份，直接操作课程、提问、回答、评论、赞踩、采纳加分和举报审查。页面调用真实接口并写入本地 D1，不展示静态假数据。

<http://127.0.0.1:8787/api/health> 单独提供 JSON 健康检查。验收页仅在 local 环境和回环地址提供；正式主站页面仍由组员2对接。

这些命令都使用个人电脑上的模拟资源；不需要登录 Cloudflare、token 或 `.local/*.csv`。Wrangler 的安装、开发服务器启动涉及工具运行，业务 D1/R2 绑定均为本地模式。安装和启动不会部署或执行远程迁移。

本地状态统一保存在 `backend/.wrangler/state/`。重复迁移只执行未应用的迁移；重复导入种子不会重置现有内容、课程编辑或会话。关闭终端停止服务，重新执行 `pnpm dev` 后数据仍在。不要把该状态目录提交到 Git。

## 前端联调

组员2的 Vite 配置将 `http://127.0.0.1:5173/api/...` 原样代理至 `127.0.0.1:8787/api/...`。前端使用相对路径，例如：

```javascript
const health = await fetch('/api/health').then(r => r.json());
// 仅本地：用虚构学生建立 HttpOnly Cookie 会话。
await fetch('/api/local/session', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: 'student-a' })
});
const response = await fetch('/api/courses/course-a/questions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify({
    title: '极限如何计算？', body: '这里支持 **Markdown** 和代码块。',
    tags: ['极限'], fileVersionId: 'version-a1'
  })
});
const result = await response.json();
```

课程入口 `/api/courses/:id/entry` 会根据当前会话返回 `permissions.canManage`，供页面显示管理操作；最终权限仍由写入接口重新检查。

同一次发布请求网络重试时复用原 `Idempotency-Key`，新发布使用新键。编辑、删除、采纳、下架携带接口最新返回的 `revision`；遇到 409 刷新状态后再操作。前端安全渲染 Markdown，过滤危险 HTML、协议和图片 URL；后端仅保存原文。

本地虚构身份包括 `student-a`、`student-b`、`visitor`、`teacher-a`、`teacher-b`、`admin`。`teacher-a` 是 `course-a` 的当前教师，`student-a/b` 是该课程当前学生；`teacher-b` 对该课程只有历史授课关系。`POST /api/local/session` 切换身份，`DELETE /api/local/session` 注销会话。该入口同时检查 local 环境和回环地址，在 dev/生产关闭。`GET /api/local/versions?courseId=...` 仅读取当前课程可见的资料版本，为验收页的版本选择器提供真实数据。真实登录接口等待组员1接入。

命令行测试可使用种子中的本地令牌，如 `Authorization: Bearer local-student-a-token-2026`；这些令牌只能用于本地样例数据，不导入云端。正式会话只接收组员1签发的不透明随机令牌，并在数据库中核验哈希、有效期和账号状态。不会信任 `X-User-Id` 或 `X-Role`。

## 接口入口

完整规范：[`docs/member3/openapi.json`](../docs/member3/openapi.json)，运行时访问 `/api/openapi.json`。其中覆盖 34 个业务方法；健康检查、本地身份工具另在本文说明。

| 模块 | 主要路径 |
| --- | --- |
| 课程 | `/api/courses`、`/api/courses/:id`、`/entry`、`/activity`、`/bonus-policy` |
| 问题 | `/api/courses/:id/questions`、`/api/questions/:id` |
| 回答 | `/api/questions/:id/answers` |
| 评论 | `/api/comments?targetKind=material\|question\|answer&targetId=...` |
| 内容维护、投票 | `/api/contents/:id`、`/api/contents/:id/vote` |
| 采纳、调分 | `/api/questions/:id/acceptance`、`/api/questions/:id/award` |
| 审查 | `/api/contents/:id/reports`、`/moderation`，`/api/moderation/reports`、`/contents/:id`、`/actions` |
| 加分与个人空间 | `/api/courses/:id/bonus-ledger`、`/bonus-summary`，`/api/me/bonus-ledger`、`/activity` |
| 组员4内部接口 | `/internal/events`、`/events/ack`、`/documents`、`/contents/:id` |

列表默认 `page=1&pageSize=20`，每页最多50条，返回 `{ items, page, pageSize, hasMore }`。内部事件使用游标，单次最多100条。普通浏览可匿名；写入需登录，管理需当前课程教师或管理员权限。

错误统一为：

```json
{"error":{"code":"STATE_CONFLICT","message":"内容已改变，请刷新后重试","requestId":"..."}}
```

常见状态码：400 参数错误，401 会话失效，403 权限不足，404 内容不可用，409 并发/重复/关联对象冲突，413 请求超过128 KiB，415 正文不是 JSON。未知 `/api` 路径返回 JSON 404。

## 检查与演示

```powershell
pnpm check
pnpm test
pnpm openapi:check
pnpm demo
```

`check` 仅进行 TypeScript 静态检查。长期回归测试位于 `backend/tests/`，在真实 workerd 和临时 D1 上验证权限、事务、并发与可见性；不以静态 JSON 模拟数据库。测试中的两个故意失败用例会记录已脱敏的 `UNHANDLED_ERROR`，用于验证事务回滚。

`demo` 创建隔离的临时本地实例，演示提问、回答、采纳、重复采纳、下架和加分冲销，结束后销毁；不会更改日常开发库。未运行前后端完整构建，遵守根目录 `AGENTS.md`。

## 环境与云端边界

本分支的 `wrangler.jsonc` 仅保留 `env.local` 的独立本地入口、DB 和 FILES 模拟绑定。顶层没有入口或绑定，不提供远程部署配置。本地初始化仍使用明确的 `--env local --local`。后续适配应使用 main 的统一 `backend/wrangler.json`，不能将此本地配置覆盖到共享部署工程。

`FILES` 已配置为组员4接入的 R2 绑定。本交付未实现上传申请、文件 PUT、完成确认、预览和下载；本地种子里的文件版本是联调元数据，不代表实际文件已上传。

部署按2026-10-26的新约定只走 GitHub Actions：个人分支提交PR，审查后合入 main 自动发布dev；生产需手动触发及审批。远程迁移由CI应用。本分支不提供本地管理token读取工具，不从CSV或 `.env` 加载Cloudflare凭据，也不从本地终端发布Worker。已撤销的管理token不得继续使用。

组员3业务规则中的待确认项、事务方案和组员间影响见[联调与规则说明](../docs/member3/联调与规则说明.md)。