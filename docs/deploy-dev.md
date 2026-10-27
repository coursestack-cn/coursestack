# 部署与运维

部署通过 [Deploy Workers](../.github/workflows/deploy.yml) 工作流：`main` 更新自动部署 dev，手动运行可选择 dev 或 production。运维配置以 [wrangler.json](../backend/wrangler.json) 为准。

## 环境

| 项目 | dev | production |
| --- | --- | --- |
| 地址 | `https://dev.coursestack.cn` | `https://coursestack.cn` |
| Worker | coursestack-dev | coursestack |
| D1 | coursestack-db-dev | coursestack-db |
| R2 | coursestack-files-dev | coursestack-files |
| Wrangler 环境与 APP_ENV | dev | production |

每套环境由同一 Worker 提供前端和 API：`/api` 及其子路径执行后端，未知接口返回 JSON 404；其他路径读取 `frontend/dist`，未知页面回退到 `index.html`。dev 为团队共享环境，每次发布替换上一次版本。

Wrangler 管理的绑定、变量、路由和可观测性在部署时由配置覆盖，应修改仓库配置；Secrets 独立保存。两套云端环境均关闭 `workers_dev` 和 `preview_urls`，仅使用配置中的 Custom Domain。顶层是无入口、绑定和路由的占位 Worker，所有云端命令必须显式选择 `--env dev` 或 `--env production`。

## GitHub Actions 配置与发布

在 **Settings > Environments** 分别配置 dev 和 production：

- 部署分支只允许 main；production 开启 Required reviewers。
- 各环境设置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` Secrets。Token 需有目标 Worker、绑定资源、Custom Domain 与 D1 写入所需权限，并限制到项目账号及区域。
- 环境配置完成后移除同名仓库级 Secrets，避免其他分支取得部署凭据。不要依赖首次运行自动创建的无保护环境。

工作流须先合入默认分支。手动发布时打开 **Actions > Deploy Workers > Run workflow**，选择 main 与目标环境；生产按所配置的审查规则等待批准。其他分支被工作流条件和环境规则共同限制。

流程依次安装锁定依赖、检查后端类型与初始化 SQL、运行后端测试、检查并构建前端，通过后初始化目标 D1、发布 Worker 与前端资源，再验证 `/api/health` 和 `/`。每个环境串行部署，新的推送不取消正在运行的发布，dev 与 production 分开排队。

## 数据库结构变更

当前原型只支持当前数据模型，`schema.ts` 与 `rules.sql` 生成单份 `migrations/0000_schema.sql`。结构变更在合入前生成、检查并审查，见[后端开发说明](../backend/README.md#数据库结构与迁移)。

云端结构变化后须先准备空目标 D1，包括清除旧迁移执行记录；工作流只应用初始化 SQL，不升级旧库或自动重置。Wrangler 会跳过已经记录的同名文件，单纯再次部署不会应用该文件的新内容。

允许结构与 Worker 替换期间短暂不可用，不要求新结构兼容旧 Worker。需要维护窗口时由部署环境控制流量，验证后恢复；应用没有关闭网站 API。初始化成功后，即使发布失败也不会回滚数据库。CI 不导入云端种子、不初始化管理员、不重置账户。

## 域名与 R2 CORS

浏览器继续请求同源 `/api/...`；会话 Cookie 不设置 Domain，写请求 Origin 必须与请求地址一致，dev 与生产不共享 Cookie 或写入来源。

浏览器直传 R2 时，在各桶 **Settings > CORS Policy** 单独保存策略。dev 桶示例：

```json
[
    {
        "AllowedOrigins": ["https://dev.coursestack.cn"],
        "AllowedMethods": ["PUT"],
        "AllowedHeaders": ["Content-Type"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
    }
]
```

生产桶仅允许 `https://coursestack.cn`；移除旧 workers.dev 来源。保存文档或部署 Worker 不会应用桶 CORS，须由运维另行保存。仅在明确测试本地页面直传云端开发桶时添加精确本地来源。

保持桶私有，预签名 URL 仍使用 R2 S3 端点，应用域名不能替代它。当前头像通过 Worker 的 FILES 绑定访问，不需要桶 CORS；资料直传接口、S3 凭据和相应验证尚待完成。

## 凭据与管理员

Cloudflare Token 不进入仓库、前端、VITE 变量、PR 或日志。CI 使用环境 Secrets；运维终端只使用当前进程环境变量或命令支持的隐藏输入，不输出 Token，也不转存凭据文件。Wrangler 运维命令显式指定目标环境；无需为此运行 `wrangler login`。

内部供数另用 Worker Secret `INTERNAL_API_TOKEN`，至少 24 字符，与 Cloudflare 管理 Token 分开；缺少时内部接口返回 503，配置约定见[事件供数](./课程与讨论.md#事件搜索与通知供数)。

每个数据库初始化结构后，由运维单独交互初始化管理员，见[管理员操作](./管理员操作.md)。目标配置只含 Account ID 和 D1 ID，后者从对应 Wrangler 环境核对；dev 与 production 使用不同文件，例如：

```sh
pnpm admin:init --remote --config .local/admin-dev.json
```

生产改用 `.local/admin-production.json`，不要复用 dev 文件。该操作在 `backend/` 执行，不属于 CI。

## 验证与回滚

部署后核对：

- `/api/health` 返回 `{data: {status: "ok", environment: "dev", database: "ok"}}`；生产对应 production。
- `/` 返回前端，未知 `/api` 返回 `404 NOT_FOUND` JSON，页面写入正常，不匹配 Origin 的写请求被拒绝。
- Cookie 无 Domain，workers.dev 与预览 URL 仍关闭。发布记录包含环境、提交、结构初始化情况和验证结果。

需要回滚时，在 `backend/` 查看部署并选择回滚：

```sh
pnpm exec wrangler deployments list --env dev
pnpm exec wrangler rollback --env dev
```

生产使用 `--env production`。回滚只恢复 Worker 代码和资源，不恢复 D1 结构或数据；结构已变化时需另行准备匹配数据库。后续 main 自动发布或手动发布会再次替换回滚版本。

生产实地部署、凭据权限、CPU 配额以及真实文件上传仍需按目标环境验证，仓库配置不代表云端已完成设置。