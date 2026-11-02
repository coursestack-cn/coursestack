# 后端开发

当前提供 Workers / TypeScript / Hono / Drizzle / D1 后端，以及本地模拟 R2 绑定。账号、会话、受控资料与头像接口见[账号与权限](../docs/账号与权限.md)；课程、问答、采纳加分、审查及内部供数接口见[课程与讨论](../docs/课程与讨论.md)；统一内容列表、单文件上传、版本管理和预览下载见[资料与文件](../docs/资料与文件.md)。

## 启动

要求 Node.js `^22.12.0 || >=24.0.0`、`pnpm@12.5.1`。所有命令在 `backend/` 执行，各应用独立安装依赖。首次准备本地环境：

```sh
pnpm install --frozen-lockfile
pnpm db:migrate --local
pnpm admin:init --local
```

`db:migrate --local` 在空库中建立结构，在已有数据库中应用尚未执行的迁移，保留原有数据和迁移记录；它不导入演示数据。`admin:init --local` 交互设置唯一管理员密码，已有密码时拒绝覆盖，仓库不预置密码；管理员命令的完整说明见[管理员操作](../docs/管理员操作.md)。需要演示环境时，直接执行下文的 `pnpm demo --local`，它会重置目标并一次完成迁移、演示学期、账号和课程初始化。

本地数据库已准备好后，日常只需启动：

```sh
pnpm dev
```

类型检查和隔离回归测试分别执行：

```sh
pnpm check
pnpm test
```

需要调用内部供数接口时，参考 `.dev.vars.example` 在被忽略的 `.dev.vars` 中设置至少 24 字符的随机 `INTERNAL_API_TOKEN`，见[搜索与内容供数](../docs/课程与讨论.md#搜索与内容供数)。

开发、迁移、演示数据和管理员命令共用 `backend/.wrangler/state`，Wrangler 数据位于其 `v3` 子目录。本地命令使用 `local` 环境与 `DB`、`FILES` 绑定，不需要云端登录；`local` 的 D1 ID 是本地占位符，路由为空。测试通过 Miniflare 启动临时 D1，退出即销毁，不连接日常数据库。

默认后端地址：`http://127.0.0.1:8787`。健康检查：

```sh
curl.exe --fail http://127.0.0.1:8787/api/health
```

上例适用于 Windows；macOS / Linux 使用 `curl`。响应：`{"data":{"status":"ok","environment":"local","database":"ok"}}`。健康检查只验证 D1 连通性，不检查结构是否已迁移。后端只提供 API，页面由前端开发服务器提供。

## 命令与目标参数

管理员、数据库和演示数据命令必须选择 `--local` 或 `--remote <配置文件>` 之一；未指定目标、同时指定两个目标或重复参数均拒绝执行。`dev` 始终使用本地开发环境；检查、结构图和规范生成命令不需要目标参数。

复制 `scripts/remote-target.example.json` 到被忽略的 `.local/remote.json`，填写 `accountId` 和 `databaseId`。`bucketName` 仅在 `demo` 时必填，其他命令可以省略。配置只保存资源标识，不保存 Token；Token 通过 `CLOUDFLARE_API_TOKEN` 或终端隐藏输入提供。远程命令只按此配置选择目标 D1，不从 production 配置推断。

| 脚本 | 用途 |
| --- | --- |
| `dev` | 启动本地 Worker、D1/R2 模拟服务 |
| `check` | TypeScript 类型检查，不生成产物 |
| `test` | 运行全部后端自动化测试 |
| `db:generate` | 比较 schema、规则与快照，追加迁移文件；可传 `--name <名称>` |
| `db:check` | 仅检查仓库中的迁移文件、快照与源定义，不连接数据库 |
| `db:diagram` | 启动结构可视化，读取 schema，不连接业务数据库 |
| `db:migrate` | 对指定目标应用尚未执行的迁移 |
| `admin:init` | 初始化唯一管理员及密码，拒绝覆盖已有密码 |
| `admin:reset` | 重置管理员密码并撤销其会话 |
| `admin:status` | 只读查询管理员状态 |
| `demo` | 每次清空指定 D1 和 R2，应用迁移并创建演示学期、账号、课程及选课关系，仅保留管理员凭据 |
| `openapi:check` | 检查路由覆盖和已导出的规范是否一致 |
| `openapi:export` | 检查路由覆盖并更新 openapi/openapi.json |

`db:migrate`、`admin:*` 和 `demo` 均可在本地传 `--persist-to <状态根目录>`，默认 `.wrangler/state`；远程操作拒绝这个参数。对同一状态目录执行 `demo` 前先停止 dev 服务。

## 开题演示账号

`demo` 每次重置目标 D1 与 R2，再应用完整迁移历史并创建两个演示学期、100 个学生账号、1 个教师账号、“数据库系统原理”课程及选课和授课关系。全新目标也可以直接执行，无需先执行迁移或配置学期；演示学期只由该命令创建，没有独立种子命令。

```sh
pnpm demo --local
pnpm demo --remote .local/remote.json
```

每次执行都会重建演示数据，不需要 `--confirm` 或交互确认。已初始化管理员的 ID、昵称和密码散列保留，其余账号、会话、头像和业务内容全部删除；管理员不存在时不会自动创建，可随后执行 `admin:init` 并指定同一目标。

学生账号为 **S0001–S0100**，教师账号为 **T0001**，初始密码同账号，均不要求首次改密。姓名均为虚构名称；学生为计算机学院、计算机科学与技术专业、2024 级，教师为同学院同专业、不填年级。课程关系归属“演示当前学期”，同时创建“演示历年学期”。这些是供课堂体验的共享测试账号，初始密码公开，不承载真实个人资料。

远程配置必须包含 `accountId`、`databaseId`、`bucketName`。Token 需要 D1 写权限和账号级 Workers R2 Storage Write（桶级 Bucket Item Write 不能调用脚本使用的 R2 REST 接口）。命令只操作所选目标，不部署网站；部署工作流在开启数据重置时调用同一命令，见[演示数据重置](../docs/部署与运维.md#演示数据重置)。

脚本先清理 R2，失败时不改动 D1，再删除 D1 的全部表和视图（含 `d1_migrations`）并重新应用迁移。管理员在迁移完成后立即恢复，再初始化演示学期、账号和课程。删除 D1 后若迁移失败，库为空且管理员丢失，可用 D1 Time Travel 恢复到重置前，或修复后重新运行再执行 `admin:init`。

## 目录结构

| 路径 | 用途 |
| --- | --- |
| `src/index.ts` | Worker 入口和错误响应 |
| `src/auth/` | 密码、会话、账号接口 |
| `src/accounts/` | 账号查询维护、资料与头像 |
| `src/courses/` | 课程创建、维护、统计与动态 |
| `src/discussions/` | 问答、评论、投票、采纳与加分流水 |
| `src/materials/` | 统一内容列表、上传会话、文件版本、受控预览下载及清理 |
| `src/moderation/` | 举报队列、下架恢复、审查记录 |
| `src/integration/` | 本人动态、内部可见文档及内容详情 |
| `src/openapi.ts`、`src/materials/openapi.ts` | 课程、讨论与资料 API 的 OpenAPI 规范 |
| `src/permissions.ts` | 管理员、当前授课教师权限与公开资料查询 |
| `src/db/schema.ts` | 共享 Drizzle 表定义 |
| `src/db/rules.sql` | 当前视图、约束与积分事务触发器 |
| `drizzle.config.ts` | Drizzle Lab 读取 schema 的配置 |
| `migrations/*.sql`、`migrations/meta/` | 按编号追加的 SQL、Drizzle 快照与规则快照，由 Wrangler 按执行记录应用 |
| `seed/local.sql` | `demo` 内部使用的演示学期数据 |
| `tests/` | 长期保留的账号、隐私、会话、管理员运维和 R2 回归测试 |
| `scripts/demo.mjs` | 重置目标并初始化全部课堂演示数据 |
| `scripts/admin.mjs`、`scripts/lib/` | 独立管理员运维命令、终端输入和 D1 访问 |

数据模型概览见[数据结构](../docs/架构与开发.md#数据结构)，字段约束见各主题文档。

## 数据库结构与迁移

数据库通过增量迁移升级。表、字段和索引在 `src/db/schema.ts` 定义；视图、触发器在 `src/db/rules.sql` 定义。`migrations/0000_schema.sql` 保留已经发布的原始基线，后续变化追加 `0001_*.sql`、`0002_*.sql` 等文件。空库从头应用全部迁移，已有库只应用 `d1_migrations` 中尚未登记的文件；已共享或已应用的迁移不得修改、删除或改名。

所有业务表统一使用 SQLite `STRICT`。当前 Drizzle 尚无表级 STRICT 选项，由 `scripts/lib/schema.mjs` 在生成每条建表语句时统一添加，新表也自动生效；不要绕过该生成器直接建库。列类型由数据库强制检查，无损类型转换仍允许，因此不逐列写 `typeof(...)` 检查。非空、数值范围、状态枚举、JSON 格式及关联约束继续保留，隔离 D1 测试通过 `PRAGMA table_list` 检查每张表的严格模式。

修改结构后，在 `backend/` 执行：

```sh
pnpm db:generate --name describe_change
pnpm db:check
pnpm check
```

`db:generate` 使用 Drizzle Kit 比较最新快照与当前 schema，追加迁移和 `meta/` 中的 schema、规则快照及 `_journal.json`，不连接数据库。没有变化时不写文件。必须同时提交源定义、SQL 和元数据。生成器为建表 SQL 添加 STRICT，并在结构变化期间暂时移除规则、随后恢复；应用前须审查数据复制、必填列回填及外键级联行为。D1 使用 `defer_foreign_keys`，不能靠关闭 `foreign_keys` 绕过约束。触发器以完整语句和 `--> statement-breakpoint` 分隔，不能按分号拆开。

`db:check` 仅检查仓库文件：迁移编号、SQL 文件与 journal 的对应关系、快照链，以及最新快照与 schema、rules 的一致性。它不连接任何数据库，不接受 `--local`、`--remote` 或其他额外参数。迁移能否成功应用由测试验证：隔离 D1 中检查完整历史的最终表、索引、约束、视图和触发器，以及有数据的旧库升级、失败回滚及业务事务。

应用已生成的本地迁移：停止本地服务，在 `backend/` 执行 `pnpm db:migrate --local`，成功后重新启动服务。无需重新初始化管理员或导入演示账号，也不要删除 `.wrangler/state` 或迁移记录。重复执行会跳过已经应用的文件。首次建立空库也使用同一命令。

`0001_materials.sql` 增加资料上传会话、版本计数、版本审查记录，并更新文件版本字段和触发器，保留已有账号、课程、问答、会话及积分。迁移检查 `file_versions` 是否为空，发现意外旧记录会以 `materials_require_empty_file_versions` 失败并回滚，须先核实文件元数据，不能直接删除记录绕过。

`0002_material_table_names.sql` 重命名两张资料表；`0003_material_version_contract.sql` 将上传 payload 改为 creation_draft，移除更新说明、独立版本状态及版本审查记录。版本只允许删除，资料整体下架沿用 contents。该迁移若检测到隐藏版本会以 `material_versions_require_no_hidden_rows` 中止并回滚，需先明确恢复或删除这些版本，避免它们被自动公开。

local、production 使用同一组迁移；生产迁移由部署工作流在发布 Worker 前执行，见[数据库结构变更](../docs/部署与运维.md#数据库结构变更)。

### 结构可视化

在 `backend/` 执行：

```sh
pnpm db:diagram
```

打开 <http://127.0.0.1:64738>，使用 [Drizzle Lab](https://github.com/rphlmr/drizzle-lab) 查看表、字段类型、可空性、主键、外键连线、默认值和 CHECK 条件。滚轮缩放、拖动画布和表节点；字段旁的箭头可以展开约束或默认值，右上角 `Auto layout` 可以重新排列。

关系图直接读取 `drizzle.config.ts` 指定的 `src/db/schema.ts`，不连接或修改本地、云端数据库。修改 schema 后重新启动命令并刷新页面。图中只有 schema 中的定义，不含生成器添加的 STRICT 及 rules.sql 中的视图和触发器。

工具版本固定在开发依赖中，布局保存到已被 Git 忽略的 `backend/.local/schema-diagram/`。按 `Ctrl+C` 停止。

## 前端联调

前端位于 `frontend/`，开发服务器已在 `frontend/vite.config.ts` 中把 `/api` 代理到 `http://127.0.0.1:8787`（可用 `DEV_API_TARGET` 覆盖），保留路径、Cookie、Set-Cookie 和原始 Host（`changeOrigin: false`）。代理若把 Host 改写为后端地址，来源检查会拒绝写请求。前端只通过该代理调用接口，不直接跨域请求后端端口。

用 curl 等客户端测试写接口时，须提供与请求地址一致的 `Origin`，JSON 接口使用 `Content-Type: application/json`。响应格式与 Cookie 约定见[请求与联调](../docs/架构与开发.md#请求与联调)。

## OpenAPI

```sh
pnpm openapi:export
pnpm openapi:check
```

前者将规范导出到仓库根目录的 `openapi/openapi.json`（前后端共用的接口契约），后者检查业务方法与实际路由及静态规范一致。修改 `src/openapi.ts` 或 `src/materials/openapi.ts` 后依次执行。`GET /api/openapi.json` 返回标准 OpenAPI 3.1 文档，不加 data 包装；它描述课程、讨论和资料模块，账号接口见[账号与权限](../docs/账号与权限.md)。仅本地开放的资料 PUT 传输接口见[资料与文件](../docs/资料与文件.md#本地与云端)。

参考：[Drizzle D1](https://orm.drizzle.team/docs/get-started/d1-new)、[D1 外键](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)、[Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)、[Workers CPU 限制](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)。