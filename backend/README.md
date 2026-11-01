# 后端开发

当前提供 Workers / TypeScript / Hono / Drizzle / D1 后端，以及本地模拟 R2 绑定。账号、会话、受控资料与头像接口见[账号与权限](../docs/账号与权限.md)；课程、问答、采纳加分、审查及内部供数接口见[课程与讨论](../docs/课程与讨论.md)；统一内容列表、单文件上传、版本管理和预览下载见[资料与文件](../docs/资料与文件.md)。

## 启动

要求 Node.js `^22.12.0 || >=24.0.0`、`pnpm@12.5.1`。所有命令在 `backend/` 执行，各应用独立安装依赖。首次准备本地环境：

```sh
pnpm install --frozen-lockfile
pnpm db:migrate --local
pnpm admin:init --local
```

`db:migrate --local` 在空库中建立结构，在已有数据库中应用尚未执行的迁移，保留原有数据和迁移记录。需要演示环境时，直接执行下文的 `pnpm demo --local`，它会重置目标并一次完成迁移、演示学期、账号和课程初始化。本地数据库已准备好后，日常只需启动：

```sh
pnpm dev
```

类型检查和隔离回归测试分别执行：

```sh
pnpm check
pnpm test
```

`admin:init --local` 在交互终端输入两次密码且不回显；初始化唯一管理员，再次执行会拒绝覆盖现有密码。管理员运维设置的密码允许短密码，但不能为空，UTF-8 不超过 72 字节；用户自行改密时新密码至少 8 个字符。不要通过命令行参数或提交文件传入密码。没有预置密码，不需要首次登录强制改密。自动化测试使用隔离的虚构账号，不替你设置日常数据库的管理员密码。

管理员密码保存在 D1 的 PBKDF2 散列中，不使用 Worker 环境变量或 Secret 作为登录密码。初始化、状态查询和外部重置命令见[管理员初始化与恢复](../docs/管理员操作.md)。本地重置使用 `pnpm admin:reset --local`；通用命令必须明确选择 `--local` 或 `--remote <目标配置>`。写入前显示目标并要求输入确认文字。远程命令直接调用 Cloudflare D1 API，不依赖网站登录或维护用 Worker，需具备目标 D1 的写权限。

演示学期由 `demo` 命令与演示账号、课程一起创建，不提供独立种子命令。`db:migrate` 只维护数据库结构，不导入演示数据。

开发、迁移、演示数据和管理员命令共用 `backend/.wrangler/state`。管理员初始化通过 Wrangler 代理访问其 `v3` 子目录，与 CLI 数据位置一致；脚本将文件 URL 转换为操作系统路径，支持 Windows 盘符、空格和中文目录。测试通过 Miniflare 启动临时 D1，退出销毁，不连接日常数据库。所有本地命令均使用 `local`，绑定名 `DB`、`FILES`；不读取凭据 CSV、不需要云端登录、不连接远程业务资源。

默认后端地址：`http://127.0.0.1:8787`。健康检查：

```sh
curl.exe --fail http://127.0.0.1:8787/api/health
```

上例适用于 Windows；macOS / Linux 使用 `curl`。响应：`{"data":{"status":"ok","environment":"local","database":"ok"}}`。健康检查验证 D1 连通性，业务使用前仍必须初始化结构。后端目前仅提供 API，直接访问根路径不会出现登录页面。

## 命令与目标参数

管理员、数据库和演示数据命令统一选择 `--local` 或 `--remote <配置文件>`，不再提供 `:local`、`:production` 别名，也不再使用分离的 `--remote --config` 写法。未指定目标、同时指定两个目标或重复参数均拒绝执行。`dev` 始终使用本地开发环境；检查、结构图和规范生成命令不需要目标参数。

复制 `scripts/remote-target.example.json` 到被忽略的 `.local/remote.json`，填写 `accountId` 和 `databaseId`。`bucketName` 仅在 `demo` 时必填，其他命令可以省略。配置只保存资源标识，不保存 Token；Token 通过 `CLOUDFLARE_API_TOKEN` 或终端隐藏输入提供。数据库迁移和演示数据命令也严格使用此配置选择远程 D1，不从 production 配置猜测目标。

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

`db:migrate`、`admin:*` 和 `demo` 均可在本地传 `--persist-to <状态根目录>`，默认 `.wrangler/state`；Wrangler 代理使用其 v3 子目录，与 dev 和数据库 CLI 共用状态。远程操作拒绝这个参数。本地演示重置为 `pnpm demo --local`，同样会清空该本地目标的 D1 与 R2；先停止使用同一状态目录的 dev 服务。

## 开题演示账号

`demo` 每次重置目标 D1 与 R2，再应用完整迁移历史并创建两个演示学期、100 个学生账号、1 个教师账号、“数据库系统原理”课程及选课和授课关系。全新目标也可以直接执行，无需先执行迁移或配置学期。

```sh
pnpm demo --local
pnpm demo --remote .local/remote.json
```

每次执行都会重建演示数据，不需要 `--confirm` 或交互确认。已初始化管理员的 ID、昵称和密码散列保留，其余账号、会话、头像和业务内容全部删除；管理员不存在时不会自动创建，可随后执行 `admin:init` 并指定同一目标。本地可用 `--persist-to <状态根目录>` 指定隔离目录，执行前停止使用同一状态目录的 dev 服务。

学生账号为 **S0001–S0100**，教师账号为 **T0001**，初始密码同账号，均不要求首次改密。姓名均为虚构名称；学生为计算机学院、计算机科学与技术专业、2024 级，教师为同学院同专业、不填年级。课程关系归属“演示当前学期”，同时创建“演示历年学期”。这些是供课堂体验的共享测试账号，初始密码公开，不承载真实个人资料。

远程配置必须包含 `accountId`、`databaseId`、`bucketName`。Token 从 `CLOUDFLARE_API_TOKEN` 或终端隐藏输入读取，需要 D1 写权限和账号级 Workers R2 Storage Write（桶级 Bucket Item Write 不能调用脚本使用的 R2 REST 接口）。命令只操作所选目标，不部署网站；部署工作流在开启数据重置时调用同一命令，开关与触发方式见[部署说明](../docs/deploy-dev.md#演示数据重置)。

脚本先清理 R2，失败时不改动 D1，再删除 D1 的全部表和视图（含 `d1_migrations`）并重新应用迁移。管理员在迁移完成后立即恢复，再初始化演示学期、账号和课程。删除 D1 后若迁移失败，库为空且管理员丢失，可用 D1 Time Travel 恢复到重置前，或修复后重新运行再执行 `admin:init`。自动化测试仅在临时库验证，不代表已经向远程库写入。

## 文件与协作入口

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

## 数据库结构与迁移

数据库通过增量迁移升级。表、字段和索引在 `src/db/schema.ts` 定义；视图、触发器在 `src/db/rules.sql` 定义。`migrations/0000_schema.sql` 保留已经发布的原始基线，后续变化追加 `0001_*.sql`、`0002_*.sql` 等文件。空库从头应用全部迁移，已有库只应用 `d1_migrations` 中尚未登记的文件；已共享或已应用的迁移不得修改、删除或改名。

所有业务表统一使用 SQLite `STRICT`。当前 Drizzle 尚无表级 STRICT 选项，由 `scripts/lib/schema.mjs` 在生成每条建表语句时统一添加，新表也自动生效；不要绕过该生成器直接建库。列类型由数据库强制检查，无损类型转换仍允许；不再逐列写 `typeof(...)` 检查。非空、数值范围、状态枚举、JSON 格式及关联约束继续保留，隔离 D1 测试通过 `PRAGMA table_list` 检查每张表的严格模式。

修改结构后，在 `backend/` 执行：

```sh
pnpm db:generate --name describe_change
pnpm db:check
pnpm check
```

`db:generate` 使用 Drizzle Kit 比较最新快照与当前 schema，追加迁移和 `meta/` 中的 schema、规则快照及 `_journal.json`，不连接数据库。没有变化时不写文件。必须同时提交源定义、SQL 和元数据。生成器为建表 SQL 添加 STRICT，并在结构变化期间暂时移除规则、随后恢复；应用前须审查数据复制、必填列回填及外键级联行为。D1 使用 `defer_foreign_keys`，不能靠关闭 `foreign_keys` 绕过约束。触发器以完整语句和 `--> statement-breakpoint` 分隔，不能按分号拆开。

`db:check` 仅检查仓库文件：迁移编号、SQL 文件与 journal 的对应关系、快照链，以及最新快照与 schema、rules 的一致性。它不连接任何数据库，也不读取 D1 中的结构、数据或迁移执行记录；不接受 `--local`、`--remote` 或其他额外参数，传入时会报错。此检查不会执行 SQL，不能单独证明迁移可以成功应用或目标数据库已经升级。迁移测试在隔离 D1 中验证完整历史的最终表、索引、约束、视图和触发器，同时验证有数据的旧库升级、失败回滚及业务事务。根据改动运行相关测试，不运行完整构建。

应用已生成的本地迁移：停止本地服务，在 `backend/` 执行 `pnpm db:migrate --local`，成功后重新启动服务。无需重新初始化管理员或导入演示账号，也不要删除 `.wrangler/state` 或迁移记录。重复执行会跳过已经应用的文件。首次建立空库也使用同一命令。

本次 `0001_materials.sql` 增加资料上传会话、版本计数、版本审查记录，并更新文件版本字段和触发器，保留已有账号、课程、问答、会话及积分。上线前已确认没有真实旧资料文件；迁移仍检查 `file_versions` 是否为空，发现意外旧记录会以 `materials_require_empty_file_versions` 失败并回滚，须先核实文件元数据，不能直接删除记录绕过。

`0002_material_table_names.sql` 重命名两张资料表；`0003_material_version_contract.sql` 将上传 payload 改为 creation_draft，移除更新说明、独立版本状态及版本审查记录。版本只允许删除，资料整体下架沿用 contents。新迁移若检测到隐藏版本会以 `material_versions_require_no_hidden_rows` 中止并回滚，需先明确处理这些版本；不会将它们自动公开。

local、production 使用同一组迁移。生产执行 `pnpm db:migrate --remote .local/remote.json`，常规部署会在发布 Worker 前自动执行该命令。推送发布不再读取旧 `RESET_DATA` 变量；演示数据重置只在手动发布明确勾选时运行。结构变更允许部署期间短暂不可用，详见[部署说明](../docs/deploy-dev.md)。数据库总体设计仍由组员 1 协调。

### 结构可视化

在 `backend/` 执行：

```sh
pnpm db:diagram
```

打开 <http://127.0.0.1:64738>，使用 [Drizzle Lab](https://github.com/rphlmr/drizzle-lab) 查看表、字段类型、可空性、主键、外键连线、默认值和 CHECK 条件。滚轮缩放、拖动画布和表节点；字段旁的箭头可以展开约束或默认值，右上角 `Auto layout` 可以重新排列。

关系图直接读取 `drizzle.config.ts` 指定的 `src/db/schema.ts`，不需要手工维护另一份结构，也不连接或修改本地、云端数据库。修改 schema 后重新启动命令并刷新页面。图中反映当前代码结构，不表示数据库已按该结构初始化；生成器添加的 STRICT、仅存在于 rules.sql 中的视图和触发器不在图中。

工具版本固定在开发依赖中，布局保存到已被 Git 忽略的 `backend/.local/schema-diagram/`。按 `Ctrl+C` 停止。

### 当前模型的协作约定

课程编号非空且唯一；创建人、修改人和更新时间必填，不再为旧课程保留空值或回退。课程和内容创建都保存 request_key/request_hash，资料发布同样保存这两个字段；演示脚本使用稳定的创建标识。课程和内容编辑按最终写入顺序生效，PATCH 仅更新提交字段；数据库和 HTTP 均无 revision。

账户基本信息统一在 accounts，普通账号只有一个身份。删除账户或切换身份仍按业务规则保留全部非基本数据；切换生成新 ID，旧身份显示“已删除”。管理员初始化既可创建账号，也可给已有无密码的唯一管理员补设密码，不覆盖已有密码。

资料存入 contents.kind=material；回答和评论使用 target_id 关联直接父内容，父级类型由父记录的 kind 查询得出，不重复存储。HTTP 的 targetKind 仍用于目标类型校验和返回父级类型。正文存储 ProseMirror JSON 文本，body 可空且有 json_valid 检查，HTTP 收发 JSON 对象；引用是正文中的链接。deleted 将标题、正文、标签置 NULL 并保留关系与操作元数据；评论删除后作为占位保留回复，问题、资料、回答删除后与 hidden 一样关闭其下分支。tags 可空且仅 question/material 可非空；操作原因直接存入管理或积分历史。

当前学期为 terms.current，师生关系为 enrollments(course_id,term_id,account_id)。每个实例恰好一位教师，允许零学生；只能新建当前学期实例，每门课程至少有一个有教师的实例。教师建课由本人任教，管理员须传 teacherId；同一 D1 batch 先登记教师行再建课，外键延迟到事务结束检查。

账户不设审计表或 data_generation，业务写入核对身份 ID 未标记删除。文件版本使用 `(material_id, version)` 复合主键，采纳存入独立 `acceptances`，六项整数积分规则存入 `course_bonus_rules`，默认均为 0，资料首次上传与后续版本分别计分；积分和手工加减统一记入 `bonus_ledger`。接口与 OpenAPI 已同步；当前约定与实现边界见[账号与权限](../docs/账号与权限.md)和[课程与讨论](../docs/课程与讨论.md)。

## 前端联调

前端位于 `frontend/`，浏览器使用相对地址 `/api/...`，开发代理保留 `/api` 路径、Cookie、Set-Cookie 和原始 Host。代理不得把 Host 改写为后端地址，否则来源检查会拒绝请求。生产由同一个 Worker 提供前端与 API。

Vite 的 `server.proxy` 配置示例：

```ts
proxy: {
  '^/api(?:[/?]|$)': {
    target: 'http://127.0.0.1:8787',
    changeOrigin: false,
  },
}
```

前端使用 `/api` 代理调用接口，不直接跨域请求后端端口。

普通业务写接口要求 `Origin` 与请求 URL 的 origin 完全一致；JSON 接口使用 `Content-Type: application/json`。Cookie 为 HttpOnly、SameSite=Strict，HTTPS 下加 Secure，不设置 `Domain`，仅发送到设置 Cookie 的主机。前端不用读取 token 或将其保存到 localStorage。curl 等客户端测试写接口也要提供匹配的 Origin。管理员登录页与普通成员登录页使用不同接口。

讨论成功响应使用 `{data: ...}`，普通列表使用 items、page、pageSize、total，时间为 Unix 秒，作者字段为 nickname，学期字段为 termId。讨论 JSON 上限128 KiB，原账号 JSON 的8 KiB和头像的2 MiB限制保持独立。Hono 先转发原账号、头像、登录处理器，保留这些接口的405与 Allow 行为；后续将原处理器改写为 Hono 路由是另一项任务。

## 内部供数与 OpenAPI

`/api/internal/*` 供后端服务分页读取当前可见文档及复查内容可见性，使用独立 Bearer 凭据；普通会话 Cookie 不能访问它们。Env 的可选 `INTERNAL_API_TOKEN` 至少24字符，未配置或过短返回503。本地参考 `.dev.vars.example`，使用随机值并保留在被忽略的本地变量文件；云端通过 Secret 配置。不要使用 Cloudflare API Token 代替它，也不要放入前端。

内部接口不经过用户 Cookie/Origin 中间件，成功响应仍包 data，文档分页返回 nextCursor、hasMore。业务事件表及事件拉取、确认接口已移除，不再返回 watermark，也不提供跨页一致快照或增量重放；搜索和通知的实现与同步方式仍待确定。课程动态改为查询当前可见内容，具体字段见课程与讨论文档。

```sh
pnpm openapi:export
pnpm openapi:check
```

前者将规范导出到仓库根目录的 `openapi/openapi.json`（前后端共用的接口契约），后者检查业务方法与实际路由及静态规范一致。`GET /api/openapi.json` 返回标准 OpenAPI 文档，不加 data 包装；它描述课程、讨论和资料模块，账号接口见[账号与权限](../docs/账号与权限.md)。仅本地开放的资料 PUT 传输接口见[资料与文件](../docs/资料与文件.md)。

## 环境边界与未完成项

`local` 的 D1 ID 是本地占位符，路由为空，不继承生产域名。云端只有 `production`，使用 `https://coursestack.cn`，由同一 Worker 同源提供前端与 API，并绑定生产 D1、R2 和前端静态资源；Custom Domain 的 `workers_dev` 和 `preview_urls` 均关闭。GitHub Actions 在 `main` 每次更新时自动部署 production，也可手动对 main 重新运行；检查通过后自动应用待执行迁移。凭据设置、运行方式和回滚边界见[部署说明](../docs/deploy-dev.md)。部署始终显式选择 `--env production`；顶层配置只是占位，不能直接部署。资料上传需配置 S3 凭据、目标桶和 CORS，资料预览下载及头像使用 Worker FILES 绑定。真实云端直传、Secrets 和 CPU 配额仍需验证。

当前后端已提供账号管理、资料维护、管理员重置成员密码、课程与讨论管理接口；名单导入和授课管理接口仍待完成。当前学期用 `terms.current` 标记，切换时在同一事务中先清除旧标记、再设置新标记，历史关系保留；尚无学期切换管理接口或自动调度。内容下架与采纳由对应业务路由校验，文件预览下载授权由 materials 模块执行。

网站不发送邮件。普通成员忘记密码时联系管理员，由管理员在系统外核实身份后通过管理接口重置；唯一管理员忘记密码时，由具备数据库权限的运维人员使用外部重置命令。头像在替换或删除时立即清理，不复用、不保留历史，无头像登记表或定时清理命令。

参考：[Drizzle D1](https://orm.drizzle.team/docs/get-started/d1-new)、[D1 外键](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)、[Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)、[Workers CPU 限制](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)。