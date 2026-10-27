# 后端开发

当前提供 Workers / TypeScript / Hono / Drizzle / D1 后端，以及本地模拟 R2 绑定。账号、会话、受控资料与头像接口见[账号与权限](../docs/账号与权限.md)；课程、问答、采纳加分、审查及内部供数接口见[课程与讨论](../docs/课程与讨论.md)。

## 启动

要求 Node.js `^22.12.0 || >=24.0.0`、`pnpm@12.5.1`。所有命令在 `backend/` 执行，各应用独立安装依赖。首次准备本地环境：

```sh
pnpm install --frozen-lockfile
pnpm db:setup:local
pnpm admin:init:local
```

`db:setup:local` 在空库中建立当前结构并初始化演示数据；同一版本可重复运行，不重置管理员密码。schema 变更后需重新创建本地 D1，不能沿用旧结构。本地数据库已准备好后，日常只需启动：

```sh
pnpm dev
```

类型检查和隔离回归测试分别执行：

```sh
pnpm check
pnpm test
```

`admin:init:local` 在交互终端输入两次密码且不回显；初始化唯一管理员，再次执行会拒绝覆盖现有密码。管理员运维设置的密码允许短密码，但不能为空，UTF-8 不超过 72 字节；用户自行改密时新密码至少 8 个字符。不要通过命令行参数或提交文件传入密码。没有预置密码，不需要首次登录强制改密。自动化测试使用隔离的虚构账号，不替你设置日常数据库的管理员密码。

管理员密码保存在 D1 的 bcrypt 散列中，不使用 Worker 环境变量或 Secret 作为登录密码。初始化、状态查询和外部重置命令见[管理员初始化与恢复](../docs/管理员操作.md)。本地重置使用 `pnpm admin:reset:local`；通用命令必须明确选择 `--local` 或 `--remote --config <目标配置>`。写入前显示目标并要求输入确认文字。远程命令直接调用 Cloudflare D1 API，不依赖网站登录或维护用 Worker，需具备目标 D1 的写权限。

种子仅创建虚构教师、学生、课程和两个演示学期，没有登录凭据。首次种子将未配置的当前学期设为演示当前学期，重复执行不覆盖已选学期或已编辑的数据。种子不是正式账号导入工具。

开发、结构初始化、种子和管理员初始化共用 `backend/.wrangler/state`。管理员初始化通过 Wrangler 代理访问其 `v3` 子目录，与 CLI 数据位置一致；脚本将文件 URL 转换为操作系统路径，支持 Windows 盘符、空格和中文目录。测试通过 Miniflare 启动临时 D1，退出销毁，不连接日常数据库。所有本地命令均使用 `local`，绑定名 `DB`、`FILES`；不读取凭据 CSV、不需要云端登录、不连接远程业务资源。

默认后端地址：`http://127.0.0.1:8787`。健康检查：

```sh
curl.exe --fail http://127.0.0.1:8787/api/health
```

上例适用于 Windows；macOS / Linux 使用 `curl`。响应：`{"data":{"status":"ok","environment":"local","database":"ok"}}`。健康检查验证 D1 连通性，业务使用前仍必须初始化结构。后端目前仅提供 API，直接访问根路径不会出现登录页面。

## 开题演示账号

独立脚本 `scripts/prepare-demo.mjs` 创建学生 **S0001–S0100** 和教师 **T0001**，新增账号初始密码同账号，均不要求首次改密。全部姓名为虚构名称，不导入真实学生信息。学生加入“数据库系统原理”的当前学期，教师建立同课程同学期的授课关系。

先初始化当前结构并配置当前学期，再预览和执行（全新本地库可先运行 `pnpm db:setup:local`）：

```sh
pnpm db:migrate:local
pnpm demo:prepare --local --dry-run
pnpm demo:prepare --local
```

同名课程只有一个时复用，否则新建；多个同名课程时用 `--course-id <课程 ID>` 明确选择。必须已经配置 `terms.current=1`，脚本不创建或切换学期。若所选课程当前学期已有其他教师，拒绝加入演示教师，不覆盖原授课关系。已有课程的加分配置保持不变。可用 `--persist-to <目录>` 指向独立的本地 Wrangler v3 状态目录。

远程目标沿用管理员运维 JSON（只含 accountId、databaseId），Token 从环境变量或终端隐藏输入读取。先按部署文档应用迁移，再执行：

```sh
pnpm demo:prepare --remote --config .local/admin-dev.json --dry-run
pnpm demo:prepare --remote --config .local/admin-dev.json
```

远程写入需在交互终端输入 `PREPARE <databaseId>`。脚本不执行迁移或部署。重复执行只补缺失的演示账号和关系，保留已有密码、昵称、账号状态、强制改密标记和业务内容；学工号被其他账号占用时拒绝覆盖。写入使用单次 D1 batch，当前学期并发变化时整批不写入，不保存密码明文或账户审计记录。

这些是供课堂体验的共享测试账号，初始密码公开，不承载真实个人资料。脚本不会创建或重置平台管理员。自动化测试仅在临时库验证，不代表已经向 dev 或生产库写入。

## 文件与协作入口

| 路径 | 用途 |
| --- | --- |
| `src/index.ts` | Worker 入口和错误响应 |
| `src/auth/` | 密码、会话、账号接口 |
| `src/accounts/` | 账号查询维护、资料与头像 |
| `src/courses/` | 课程创建、维护、统计与动态 |
| `src/discussions/` | 问答、评论、投票、采纳与加分流水 |
| `src/moderation/` | 举报队列、下架恢复、审查记录 |
| `src/integration/` | 本人动态、内部可见文档及内容详情 |
| `src/openapi.ts` | 32个课程与讨论业务方法的 OpenAPI 规范 |
| `src/permissions.ts` | 管理员、当前授课教师权限与公开资料查询 |
| `src/db/schema.ts` | 共享 Drizzle 表定义 |
| `src/db/rules.sql` | 当前视图、约束与积分事务触发器 |
| `drizzle.config.ts` | Drizzle Lab 读取 schema 的配置 |
| `migrations/0000_schema.sql` | 从当前 schema 和规则生成的空库初始化 SQL，由 Wrangler 执行 |
| `seed/local.sql` | 可重复执行的虚构关系数据 |
| `tests/` | 长期保留的账号、隐私、会话、管理员运维和 R2 回归测试 |
| `scripts/prepare-demo.mjs` | 可预览、可重复运行的课堂演示账号与课程关系准备 |
| `scripts/admin.mjs`、`scripts/lib/` | 独立管理员运维命令、终端输入和 D1 访问 |

## 数据库结构与迁移

当前原型只支持当前数据模型，不维护旧数据升级、新旧 Worker 共存、历史快照或回填逻辑。表、字段和索引在 `src/db/schema.ts` 定义；视图、触发器在 `src/db/rules.sql` 定义。两者生成唯一的 `migrations/0000_schema.sql`，只用于空数据库初始化。

所有业务表统一使用 SQLite `STRICT`。当前 Drizzle 尚无表级 STRICT 选项，由 `scripts/lib/schema.mjs` 在生成每条建表语句时统一添加，新表也自动生效；不要绕过该生成器直接建库。列类型由数据库强制检查，无损类型转换仍允许；不再逐列写 `typeof(...)` 检查。非空、数值范围、状态枚举、JSON 格式及关联约束继续保留，隔离 D1 测试通过 `PRAGMA table_list` 检查每张表的严格模式。

修改结构后，在 `backend/` 执行：

```sh
pnpm db:generate
pnpm db:check
pnpm check
```

`db:generate` 每次从空结构重新生成并覆盖初始化 SQL，不连接数据库，不生成增量迁移。提交源定义和生成的 SQL，不维护 `meta/`、journal 或历史升级脚本。触发器使用完整语句，以 `--> statement-breakpoint` 分隔，不能按分号拆开。

`db:check` 重新生成目标 SQL 并逐字比较，防止 schema、规则和初始化文件脱节。隔离 D1 测试验证空库初始化、约束和业务事务；不再测试旧版本升级。根据改动运行相关测试，不运行完整构建。

schema 变化后，停止本地服务并重新创建本地 D1，再执行 `pnpm db:setup:local` 和管理员初始化。Wrangler 将同名 SQL 记录为已执行，单独重跑 `db:migrate:local` 不会更新旧库。不要删除整个 `.wrangler/state` 来重置 D1，以免同时清除 R2 数据；本轮代码修改不会自动清理现有本地状态。

local、dev、production 使用同一份当前初始化 SQL。云端目标也必须先准备空 D1（含清除旧的迁移执行记录），由部署流程初始化；当前工作流不自动重置数据库。结构变更允许部署期间短暂不可用，详见[部署说明](../docs/deploy-dev.md)。数据库总体设计仍由组员 1 协调。

### 结构可视化

在 `backend/` 执行：

```sh
pnpm db:diagram
```

打开 <http://127.0.0.1:64738>，使用 [Drizzle Lab](https://github.com/rphlmr/drizzle-lab) 查看表、字段类型、可空性、主键、外键连线、默认值和 CHECK 条件。滚轮缩放、拖动画布和表节点；字段旁的箭头可以展开约束或默认值，右上角 `Auto layout` 可以重新排列。

关系图直接读取 `drizzle.config.ts` 指定的 `src/db/schema.ts`，不需要手工维护另一份结构，也不连接或修改本地、云端数据库。修改 schema 后重新启动命令并刷新页面。图中反映当前代码结构，不表示数据库已按该结构初始化；生成器添加的 STRICT、仅存在于 rules.sql 中的视图和触发器不在图中。

工具版本固定在开发依赖中，布局保存到已被 Git 忽略的 `backend/.local/schema-diagram/`。按 `Ctrl+C` 停止。

### 当前模型的协作约定

课程编号非空且唯一；创建人、修改人和更新时间必填，不再为旧课程保留空值或回退。课程和内容创建都须保存 request_key/request_hash，资料发布实现也应提供这两个字段；种子与演示脚本使用稳定的创建标识。课程和内容编辑按最终写入顺序生效，PATCH 仅更新提交字段；数据库和 HTTP 均无 revision。

账户基本信息统一在 accounts，普通账号只有一个身份。删除账户或切换身份仍按业务规则保留全部非基本数据；切换生成新 ID，旧身份显示“已删除”。管理员初始化既可创建账号，也可给已有无密码的唯一管理员补设密码，不覆盖已有密码。

资料存入 contents.kind=material；回答和评论使用 target_kind/target_id 关联直接父内容。正文存储 ProseMirror JSON 文本，body 可空且有 json_valid 检查，HTTP 收发 JSON 对象；引用是正文中的链接。deleted 将标题、正文、标签置 NULL，保留关系与操作元数据作为占位，hidden 隐藏整个分支。tags 可空且仅 question/material 可非空；操作原因直接存入管理或积分历史。

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

普通业务写接口要求 `Origin` 与请求 URL 的 origin 完全一致；JSON 接口使用 `Content-Type: application/json`。Cookie 为 HttpOnly、SameSite=Strict，HTTPS 下加 Secure，不设置 `Domain`，仅发送到设置 Cookie 的主机，避免生产站点与 dev 子域名共享会话 Cookie。前端不用读取 token 或将其保存到 localStorage。curl 等客户端测试写接口也要提供匹配的 Origin。管理员登录页与普通成员登录页使用不同接口。

讨论成功响应使用 `{data: ...}`，普通列表使用 items、page、pageSize、total，时间为 Unix 秒，作者字段为 nickname，学期字段为 termId。讨论 JSON 上限128 KiB，原账号 JSON 的8 KiB和头像的2 MiB限制保持独立。Hono 先转发原账号、头像、登录处理器，保留这些接口的405与 Allow 行为；后续将原处理器改写为 Hono 路由是另一项任务。

## 内部供数与 OpenAPI

`/api/internal/*` 供后端服务分页读取当前可见文档及复查内容可见性，使用独立 Bearer 凭据；普通会话 Cookie 不能访问它们。Env 的可选 `INTERNAL_API_TOKEN` 至少24字符，未配置或过短返回503。本地参考 `.dev.vars.example`，使用随机值并保留在被忽略的本地变量文件；云端通过 Secret 配置。不要使用 Cloudflare API Token 代替它，也不要放入前端。

内部接口不经过用户 Cookie/Origin 中间件，成功响应仍包 data，文档分页返回 nextCursor、hasMore。业务事件表及事件拉取、确认接口已移除，不再返回 watermark，也不提供跨页一致快照或增量重放；搜索和通知的实现与同步方式仍待确定。课程动态改为查询当前可见内容，具体字段见课程与讨论文档。

```sh
pnpm openapi:export
pnpm openapi:check
```

前者将 `src/openapi.ts` 导出到仓库根目录的 `openapi/openapi.json`（前后端共用的接口契约），后者检查32个业务方法与实际路由及静态规范一致。`GET /api/openapi.json` 返回标准 OpenAPI 文档，不加 data 包装；它描述课程和讨论模块，账号接口见[账号与权限](../docs/账号与权限.md)。

## 环境边界与未完成项

`local` 的 D1 ID 是本地占位符，路由为空，不继承生产域名。云端 `dev` 使用 `https://dev.coursestack.cn`，`production` 使用 `https://coursestack.cn`；每套环境由同一 Worker 同源提供前端与 API，并绑定各自的 D1、R2 和前端静态资源。两套 Custom Domain 的 `workers_dev` 和 `preview_urls` 均关闭。GitHub Actions 在 `main` 更新时自动部署 dev，手动运行可选 dev 或 production；检查通过后自动应用目标环境的待执行迁移。凭据设置、运行方式和回滚边界见[部署说明](../docs/deploy-dev.md)。部署始终显式选择 `--env dev` 或 `--env production`；顶层配置只是名为 `coursestack-env-required` 的占位，没有入口、绑定和路由，不能直接部署。生产实地部署、Secrets 使用和 CPU 配额仍待验证。R2 目前只通过 Worker 绑定用于头像，尚无课程资料直传、下载接口；桶 CORS 是后续浏览器直传的配置，不影响当前同源头像接口。

当前后端已提供账号管理、资料维护、管理员重置成员密码、课程与讨论管理接口；名单导入和授课管理接口仍待完成。当前学期用 `terms.current` 标记，切换时在同一事务中先清除旧标记、再设置新标记，历史关系保留；尚无学期切换管理接口或自动调度。内容下架与采纳由对应业务路由校验，文件下载授权仍由组员4实现。

网站不发送邮件。普通成员忘记密码时联系管理员，由管理员在系统外核实身份后通过管理接口重置；唯一管理员忘记密码时，由具备数据库权限的运维人员使用外部重置命令。头像在替换或删除时立即清理，不复用、不保留历史，无头像登记表或定时清理命令。

参考：[Drizzle D1](https://orm.drizzle.team/docs/get-started/d1-new)、[D1 外键](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)、[Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)、[bcrypt.js 的 72 字节限制](https://github.com/dcodeIO/bcrypt.js#security-considerations)。