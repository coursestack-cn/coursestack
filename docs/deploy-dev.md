# 部署与运维

部署通过 [Deploy Workers](../.github/workflows/deploy.yml) 工作流：`main` 每次更新都自动部署 production，也可手动对 main 重新运行。运维配置以 [wrangler.json](../backend/wrangler.json) 为准。

## 环境

| 项目 | production |
| --- | --- |
| 地址 | `https://coursestack.cn` |
| Worker | coursestack |
| D1 | coursestack-db |
| R2 | coursestack-files |
| Wrangler 环境与 APP_ENV | production |

云端只有 production 一套环境，没有单独的共享联调环境，合入 main 即上线。同一 Worker 提供前端和 API：`/api` 及其子路径执行后端，未知接口返回 JSON 404；其他路径读取 `frontend/dist`，未知页面回退到 `index.html`。每次发布替换上一次版本。

Wrangler 管理的绑定、变量、路由和可观测性在部署时由配置覆盖，应修改仓库配置；Secrets 独立保存。生产环境关闭 `workers_dev` 和 `preview_urls`，仅使用配置中的 Custom Domain。顶层是无入口、绑定和路由的占位 Worker，`local` 环境只用于本地，所有云端命令必须显式选择 `--env production`。

## GitHub Actions 配置与发布

在 **Settings > Environments** 配置 production：

- 部署分支只允许 main。开启 Required reviewers 时，每次 main 更新都要等待批准后才发布。
- 设置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` Secrets。Token 需有目标 Worker、绑定资源、Custom Domain 与 D1 写入所需权限，开启[演示数据重置](#演示数据重置)时还需账号级 Workers R2 Storage Write（桶级 Bucket Item Write 不能调用 R2 REST 接口），并限制到项目账号及区域。
- 环境配置完成后移除同名仓库级 Secrets，避免其他分支取得部署凭据。不要依赖首次运行自动创建的无保护环境。

工作流须先合入默认分支。推送或合并到 main 即触发生产发布；需要重新发布当前 main 时，打开 **Actions > Deploy Workers > Run workflow** 并选择 main。其他分支被工作流条件和环境规则共同限制。

流程依次安装锁定依赖、检查后端类型与迁移快照、运行后端测试、检查并构建前端，通过后应用待执行的 D1 迁移，再发布 Worker 与前端资源，最后验证 `/api/health` 和 `/`。发布串行排队，新的推送不取消正在运行的发布。仅显式请求演示数据重置时改为发布后重建演示环境。

### 演示数据重置

手动发布的 `reset_data` 默认关闭，内部转换为布尔开关 `RESET_DATA`：

- true：发布后运行 `pnpm demo --remote .local/remote.json`，删除生产 D1 的全部表和视图（含迁移记录）及 R2 桶的全部文件，由同一命令重新应用完整迁移历史、初始化两个演示学期和[开题演示数据](../backend/README.md#开题演示账号)。已初始化管理员的 ID、昵称和密码散列保留，其会话、头像以及其他账号和业务数据全部删除。
- false：发布前应用尚未执行的迁移，保留已有业务数据和 R2 文件，不导入演示数据。

推送触发的发布始终执行迁移，不重置数据，也不再读取仓库或环境中原有的 `RESET_DATA` 变量。只有手动 **Run workflow** 明确勾选 `reset_data` 才会重置。重置在发布之后执行，期间新 Worker 可能短暂面对旧结构或空库。重置先清理 R2，失败时不改动 D1；删除 D1 后若迁移失败，库为空且管理员丢失，可用 `wrangler d1 time-travel restore DB --env production --timestamp <重置前时间>` 恢复，或修复后重新运行工作流再初始化管理员。

## 数据库结构变更

`schema.ts` 与 `rules.sql` 维护当前目标结构，通过 `pnpm db:generate --name <change>` 追加迁移和快照，保留已应用的 `0000_schema.sql` 及后续历史。结构变更在合入前生成、检查并审查，见[后端开发说明](../backend/README.md#数据库结构与迁移)。

工作流从 production Wrangler 配置与账号环境变量生成不含凭据的 `.local/remote.json`。常规发布在替换 Worker 前执行 `pnpm db:migrate --remote .local/remote.json`，由 Wrangler 根据 `d1_migrations` 应用待执行文件。无需清空生产 D1 或迁移记录；重复部署会跳过已应用迁移，空库则顺序应用完整历史。本次 `0001_materials.sql` 保留账号、课程、问答、会话和积分；旧 file_versions 应为空，若检测到意外记录则中止并回滚，待核实其文件元数据后再处理。

允许迁移与 Worker 替换期间短暂不可用。需要维护窗口时由部署环境控制流量，验证后恢复；应用没有关闭网站 API。迁移成功后，即使发布失败也不会自动回滚数据库；修复通过追加迁移或明确的数据库恢复操作完成。CI 不初始化管理员；关闭演示数据重置时也不导入云端种子、不重置账户。

## 域名与 R2 CORS

浏览器继续请求同源 `/api/...`；会话 Cookie 不设置 Domain，写请求 Origin 必须与请求地址一致。

浏览器直传 R2 时，在生产桶 **Settings > CORS Policy** 保存策略：

```json
[
    {
        "AllowedOrigins": ["https://coursestack.cn"],
        "AllowedMethods": ["PUT"],
        "AllowedHeaders": ["Content-Type"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
    }
]
```

生产桶仅允许 `https://coursestack.cn`，不添加本地来源；移除旧 workers.dev 和 dev 子域名来源。保存文档或部署 Worker 不会应用桶 CORS，须由运维另行保存。

保持桶私有，预签名 URL 使用 R2 S3 端点。头像、资料预览下载通过 Worker 的 FILES 绑定访问；资料上传使用预签名 PUT，浏览器按票据发送原始 File/Blob。签名绑定 Content-Type 和 Content-Length；长度由浏览器自动发送，前端不手工设置该头，也不使用 multipart/form-data。

资料上传需要单独配置 Worker 的 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`，它们与部署用 CLOUDFLARE_API_TOKEN 分开。S3 凭据应限制到资料桶。`R2_BUCKET_NAME` 由 Wrangler 管理，必须与 FILES 绑定一致；缺少有效配置时上传申请返回503。提交的 `.dev.vars.example` 只包含空值，本地模拟上传不需要这些凭据。

`MATERIAL_MAX_BYTES` 默认104857600（100 MiB），可下调。生产配置包含每小时第17分钟执行的资料上传清理任务；它回收临时文件和已无版本引用的正式文件，保留仍被版本引用的文件。协议、清理等待时间和重试行为见[资料与文件](./资料与文件.md)。部署前需在实际目标桶验证直传、签名大小/类型限制、CORS、确认发布、资料下架后的访问限制与版本删除后的文件回收；仓库测试不代表已验证云端配置。

## 凭据与管理员

Cloudflare Token 不进入仓库、前端、VITE 变量、PR 或日志。CI 使用环境 Secrets；运维终端只使用当前进程环境变量或命令支持的隐藏输入，不输出 Token，也不转存凭据文件。Wrangler 运维命令显式指定 `--env production`；无需为此运行 `wrangler login`。

内部供数另用 Worker Secret `INTERNAL_API_TOKEN`，至少 24 字符，与 Cloudflare 管理 Token 分开；缺少时内部接口返回 503，配置约定见[事件供数](./课程与讨论.md#事件搜索与通知供数)。

生产数据库初始化结构后，由运维单独交互初始化管理员，见[管理员操作](./管理员操作.md)。演示数据重置保留已初始化的管理员，只有重置前尚无管理员时才需另行初始化。目标配置包含 Account ID 和 D1 ID，可带 bucketName，后者从 production Wrangler 环境核对，例如：

```sh
pnpm admin:init --remote .local/remote.json
```

该操作在 `backend/` 执行，不属于 CI。

## 验证与回滚

部署后核对：

- `/api/health` 返回 `{data: {status: "ok", environment: "production", database: "ok"}}`。
- `/` 返回前端，未知 `/api` 返回 `404 NOT_FOUND` JSON，页面写入正常，不匹配 Origin 的写请求被拒绝。
- Cookie 无 Domain，workers.dev 与预览 URL 仍关闭。发布记录包含环境、提交、结构初始化情况和验证结果。

需要回滚时，在 `backend/` 查看部署并选择回滚：

```sh
pnpm exec wrangler deployments list --env production
pnpm exec wrangler rollback --env production
```

回滚只恢复 Worker 代码和资源，不恢复 D1 结构或数据；结构已变化时需另行准备匹配数据库。下一次 main 更新或手动发布会再次替换回滚版本，开启演示数据重置时还会再次清空数据。

生产实地部署、凭据权限、CPU 配额以及真实文件上传仍需在生产环境验证，仓库配置不代表云端已完成设置。