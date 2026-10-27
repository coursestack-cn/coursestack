# 后端开发

当前提供 Workers / TypeScript / Hono / Drizzle / D1 后端，以及本地模拟 R2 绑定。账号基础详见[账号与权限基础](../docs/组员1-账号与权限基础.md)；课程、问答、采纳加分及审查接口已从组员3分支移植，见[联调与规则说明](../docs/member3/联调与规则说明.md)。

账号列表、禁用／恢复、保留业务数据的删除／身份切换、基本信息维护、管理员重置成员密码、昵称与头像已实现，完整接口见[账号管理与资料接口](../docs/组员1-账号管理与资料接口.md)。

## 启动

要求 Node.js `^22.12.0 || >=24.0.0`、`pnpm@12.5.1`。所有命令在 `backend/` 执行，各应用独立安装依赖。首次准备本地环境：

```sh
pnpm install --frozen-lockfile
pnpm db:setup:local
pnpm admin:init:local
```

`db:setup:local` 依次执行本地迁移和演示数据初始化，可重复运行，不重置已有数据或管理员密码。本地数据库已准备好后，日常只需启动：

```sh
pnpm dev
```

类型检查和隔离回归测试分别执行：

```sh
pnpm check
pnpm test
```

`admin:init:local` 在交互终端输入两次密码且不回显；初始化唯一管理员，再次执行会拒绝覆盖现有密码。管理员运维设置的密码允许短密码，但不能为空，UTF-8 不超过 72 字节；用户自行改密时新密码至少 8 个字符。不要通过命令行参数或提交文件传入密码。没有预置密码，不需要首次登录强制改密。自动化测试使用隔离的虚构账号，不替你设置日常数据库的管理员密码。

管理员密码保存在 D1 的 bcrypt 散列中，不使用 Worker 环境变量或 Secret 作为登录密码。初始化、状态查询和外部重置命令见[管理员初始化与恢复](../docs/组员1-管理员初始化与恢复.md)。本地重置使用 `pnpm admin:reset:local`；通用命令必须明确选择 `--local` 或 `--remote --config <目标配置>`。写入前显示目标并要求输入确认文字。远程命令直接调用 Cloudflare D1 API，不依赖网站登录或维护用 Worker，需具备目标 D1 的写权限。

种子仅创建虚构教师、学生、课程和两个演示学期，没有登录凭据。首次种子将未配置的当前学期设为演示当前学期，重复执行不覆盖已选学期或已编辑的数据。种子不是正式账号导入工具。

开发、迁移、种子和管理员初始化共用 `backend/.wrangler/state`。管理员初始化通过 Wrangler 代理访问其 `v3` 子目录，与 CLI 数据位置一致；脚本将文件 URL 转换为操作系统路径，支持 Windows 盘符、空格和中文目录。测试通过 Miniflare 启动临时 D1，退出销毁，不连接日常数据库。所有本地命令均使用 `local`，绑定名 `DB`、`FILES`；不读取凭据 CSV、不需要云端登录、不连接远程业务资源。

默认后端地址：`http://127.0.0.1:8787`。健康检查：

```sh
curl.exe --fail http://127.0.0.1:8787/api/health
```

上例适用于 Windows；macOS / Linux 使用 `curl`。响应：`{"data":{"status":"ok","environment":"local","database":"ok"}}`。健康检查验证 D1 连通性，业务使用前仍必须执行迁移。后端目前仅提供 API，直接访问根路径不会出现登录页面。

## 开题演示账号

独立脚本 `scripts/prepare-demo.mjs` 创建学生 **S0001–S0100** 和教师 **T0001**，新增账号初始密码同账号，均不要求首次改密。全部姓名为虚构名称，不导入真实学生信息。学生加入“数据库系统原理”的当前学期，教师建立同课程同学期的授课关系。

先应用全部迁移并配置当前学期，再预览和执行（全新本地库可先运行 `pnpm db:setup:local`）：

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

远程写入需在交互终端输入 `PREPARE <databaseId>`。脚本不执行迁移或部署。重复执行只补缺失的演示账号和关系，保留已有密码、昵称、账号状态、强制改密标记和业务内容；学工号被其他账号占用时拒绝覆盖。写入使用单次 D1 batch，当前学期并发变化时整批不写入。审计使用 `demo.initialize`，不保存明文密码。

这些是供课堂体验的共享测试账号，初始密码公开，不承载真实个人资料。脚本不会创建或重置平台管理员。自动化测试仅在临时库验证，不代表已经向 dev 或生产库写入。

## 文件与协作入口

| 路径 | 用途 |
| --- | --- |
| `src/index.ts` | Worker 入口和错误响应 |
| `src/auth/` | 密码、会话、账号接口 |
| `src/accounts/` | 账号查询维护、资料、头像、修改审计 |
| `src/courses/` | 课程创建、维护、统计与动态 |
| `src/discussions/` | 问答、评论、投票、采纳与加分流水 |
| `src/moderation/` | 举报队列、下架恢复、审查记录 |
| `src/integration/` | 本人动态、内部事件及搜索文档 |
| `src/openapi.ts` | 34个课程与讨论业务方法的 OpenAPI 规范 |
| `src/permissions.ts` | 管理员、当前授课教师、学籍查询 |
| `src/db/schema.ts` | 共享 Drizzle 表定义 |
| `drizzle.config.ts` | Drizzle Kit 的 schema 与迁移输出配置 |
| `migrations/` | 按编号追加、由 Wrangler 执行的 D1 SQL 迁移 |
| `migrations/meta/` | Kit 增量生成所需的结构快照与 journal，一并提交 |
| `seed/local.sql` | 可重复执行的虚构关系数据 |
| `tests/` | 长期保留的账号、隐私、会话、管理员运维和 R2 回归测试 |
| `scripts/prepare-demo.mjs` | 可预览、可重复运行的课堂演示账号与课程关系准备 |
| `scripts/admin.mjs`、`scripts/lib/` | 独立管理员运维命令、终端输入和 D1 访问 |

## 数据库结构与迁移

`src/db/schema.ts` 定义当前目标结构，Drizzle Kit 根据它和上一份快照生成增量 SQL。当前固定使用 `drizzle-orm@0.45.4` 与 `drizzle-kit@0.31.11`，保留平铺 SQL 与 `meta/` 的目录格式。`drizzle.config.ts` 只配置生成所需的路径和 SQLite 方言，不包含数据库连接或凭据。

修改结构后，在 `backend/` 执行：

```sh
pnpm db:generate --name add_course_description
pnpm db:check
pnpm check
pnpm test
```

`db:generate` 只生成文件，不连接或修改数据库。审查 SQL，特别是重命名、表重建、删除字段和数据回填；生成器不能代替业务数据迁移设计。确认后用 `pnpm db:migrate:local` 应用到自己的开发库。纯数据回填可先运行 `pnpm db:generate --custom --name backfill_example`，再填写生成的 SQL；结构变更仍需先更新 schema。

同一个 PR 必须包含 schema、对应 SQL、`migrations/meta/` 中的快照和 journal。已共享或已应用的迁移不能修改、删除或改名，修正通过新迁移追加。多人修改结构时先同步目标分支，再解决迁移编号和快照分叉；只有尚未共享或应用的迁移可以重新生成。数据库总体设计仍由组员 1 协调。

`db:check` 检查快照历史、SQL 与 journal 的对应关系，以及当前 schema 是否已经生成迁移。部署流程在应用迁移前执行它和后端测试；CI 不生成迁移。测试使用隔离 D1，验证空库结构、旧数据升级和增量生成，不使用日常数据库。`pnpm check` 只执行 TypeScript 检查，这些检查和测试均不执行完整构建。

local、dev、production 使用同一套 SQL，各环境由 Wrangler 的 `d1_migrations` 表分别记录执行进度。只通过 Wrangler 应用迁移，不混用 `drizzle-kit migrate` 或 `push`。云端执行方式见[部署说明](../docs/deploy-dev.md)。

### 结构可视化

在 `backend/` 执行：

```sh
pnpm db:diagram
```

打开 <http://127.0.0.1:64738>，使用 [Drizzle Lab](https://github.com/rphlmr/drizzle-lab) 查看表、字段类型、可空性、主键、外键连线、默认值和 CHECK 条件。滚轮缩放、拖动画布和表节点；字段旁的箭头可以展开约束或默认值，右上角 `Auto layout` 可以重新排列。

关系图直接读取 `drizzle.config.ts` 指定的 `src/db/schema.ts`，不需要手工维护另一份结构，也不连接或修改本地、云端数据库。修改 schema 后重新启动命令并刷新页面。图中反映的是当前代码结构，不表示数据库已应用迁移；仅存在于 SQL 迁移中的视图和触发器不在图中。

工具版本固定在开发依赖中，布局保存到已被 Git 忽略的 `backend/.local/schema-diagram/`。按 `Ctrl+C` 停止。

### 现有迁移的接入基线

`0001`～`0004` 的文件名和 SQL 保持原样，并登记进 journal；`meta/0004_snapshot.json` 是接入 Kit 时的逻辑结构基线，未补造前三份历史快照，也不新增全量建表迁移。journal 的时间戳表示接入顺序，不能用来判断任何环境是否已经执行迁移。

`0005_align_unique_indexes.sql` 将 `credentials.school_number` 和 `account_private.email` 的旧内联 UNIQUE 约束改为 Kit 使用的命名唯一索引。迁移复制全部原值后替换这两张表，保留唯一性、外键及凭据版本约束，避免未来生成的 DROP INDEX 指向不存在的索引。账号接口、其他模块的账号引用和业务权限保持一致。新库依次执行全部迁移，已有库只执行 Wrangler 记录中尚未应用的部分。

`0006_single_account_role.sql` 限制每个账号只能有一个身份，在当时的分表结构上保留角色复合外键；后续 0010 将其合并。历史多身份数据会使迁移失败，需组员1确认处理，不自动删除角色。`0007_discussions.sql` 新建讨论表及资料/版本最小表，并只向 courses 追加列；空编号可并存、非空编号唯一，旧 updated_at 回填 created_at，基础课程缺少操作者时不产生伪造事件。`0008_discussion_rules.sql` 建立公开可见性视图、内容约束、采纳流水及事务事件触发器。触发器以完整语句和 statement-breakpoint 分隔，不能按分号拆开。

`0009_password_change_requirement.sql` 为 credentials 追加 must_change_password，默认 false，现有账号不会被强制改密。管理员重置支持可选密码（留空随机生成）及改密要求；登录和 me 返回 mustChangePassword，待改密会话由服务端拦截业务操作，详情见账号接口文档。部署新代码前必须应用全部迁移。

`0010_consolidate_accounts.sql` 合并账户基本信息到 accounts，删除邮箱及 account revision，使用 nickname、name、单个 role，并新增 department、major、grade 和内部 data_generation。迁移保留旧 ID、密码、会话及业务数据，遇到不一致的重复姓名／学工号时整笔拒绝。角色切换创建新 ID，旧身份退役为“已删除”；删除账户和身份切换均保留全部业务表记录。完整字段与协作影响见账号接口文档。

`0011_merge_material_contents.sql` 将资料合并为 `contents.kind=material`，删除 materials；回答、评论的直接父级统一使用 target_kind/target_id 自引用，删除 question_id、reply_to_id、file_version_id。file_versions.material_id 改为引用 contents 并校验 material 类型。旧文件引用转换为正文 Markdown 链接；ID、文件记录、采纳与积分历史保留，资料与讨论 ID 碰撞会整笔拒绝。旧资料没有正文和时间，正文为空、时间记迁移时刻，不补造创建事件。公开查询跨过 deleted 占位保留子内容，hidden 隐藏整个分支。联调变更见[组员3说明](../docs/member3/联调与规则说明.md)。

`0012_simplify_academics_and_content_metadata.sql` 将当前学期合入 `terms.current`（0/1，至多一个 1），将师生关系合为 `enrollments(course_id,term_id,account_id)`，删除关系的 created_at。教师行代表课程实例：每个实例恰好一位教师，学生可为零；只能新建当前学期的实例，每门课程至少保留一个有教师的实例。触发器根据 accounts.role 校验，替换教师须更新原教师行，不能先删除再添加。迁移保留全部历史关系；旧数据存在多教师、无教师课程或无教师的学生名单时整笔拒绝，须先明确处理冲突。

同一迁移删除 `contents.change_reason`，操作原因直接存入 moderation_actions 或 bonus_ledger，并与对应修改在同一事务中写入。tags 可空，仅 question/material 可存 JSON 数组；旧空数组转为 null，其他类型上的已有标签会使迁移拒绝，避免静默丢失。

教师建课时由本人任教；管理员建课必须传入 `teacherId`。两者都在同一 D1 batch 中先登记当前学期 enrollments 教师行，再创建课程，外键检查延迟到事务结束。管理员可跨课程采纳、取消和调分。请求入口验证会话、凭据版本和身份；写入 SQL 检查身份的 data_generation 及课程／学期等业务条件。普通会话撤销允许已获准请求完成；身份被标记删除后拒绝旧请求写入。课程与成员写入由组员1审查，文件版本和访问接口由组员4继续扩展。课程加分仍是原移植实现，待按已讨论的新积分规则另行调整，详见组员3联调文档。

参考：[Drizzle Kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)。在线文档可能展示新版 Kit 的目录布局，升级工具时需要同步验证配置、快照和迁移加载。

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

`/api/internal/*` 供后端服务拉取事件、确认处理和建立搜索索引，使用独立 Bearer 凭据；普通会话 Cookie 不能访问它们。Env 的可选 `INTERNAL_API_TOKEN` 至少24字符，未配置或过短返回503。本地参考 `.dev.vars.example`，使用随机值并保留在被忽略的本地变量文件；云端通过 Secret 配置。不要使用 Cloudflare API Token 代替它，也不要放入前端。

内部接口不经过用户 Cookie/Origin 中间件，成功响应仍包 data，游标保留 nextCursor、hasMore 和搜索快照的 watermark。消费方记录第一页 watermark，分页结束后重放其后事件；消费者存储、去重和通知发送不属于本次实现。

```sh
pnpm openapi:export
pnpm openapi:check
```

前者将 `src/openapi.ts` 导出到 `docs/member3/openapi.json`，后者检查34个业务方法与实际路由及静态规范一致。`GET /api/openapi.json` 返回标准 OpenAPI 文档，不加 data 包装；它描述课程和讨论模块，原账号接口继续以组员1文档为准。本次不提供原分支的 `/api/local/*`、本地验收页或 `pnpm demo`。

## 环境边界与未完成项

`local` 的 D1 ID 是本地占位符，路由为空，不继承生产域名。云端 `dev` 使用 `https://dev.coursestack.cn`，`production` 使用 `https://coursestack.cn`；每套环境由同一 Worker 同源提供前端与 API，并绑定各自的 D1、R2 和前端静态资源。两套 Custom Domain 的 `workers_dev` 和 `preview_urls` 均关闭。GitHub Actions 在 `main` 更新时自动部署 dev，手动运行可选 dev 或 production；检查通过后自动应用目标环境的待执行迁移。凭据设置、运行方式和回滚边界见[部署说明](../docs/deploy-dev.md)。部署始终显式选择 `--env dev` 或 `--env production`；顶层配置只是名为 `coursestack-env-required` 的占位，没有入口、绑定和路由，不能直接部署。生产实地部署、Secrets 使用和 CPU 配额仍待验证。R2 目前只通过 Worker 绑定用于头像，尚无课程资料直传、下载接口；桶 CORS 是后续浏览器直传的配置，不影响当前同源头像接口。

当前后端已提供账号管理、资料维护、管理员重置成员密码、课程与讨论管理接口；名单导入和授课管理接口仍待完成。当前学期用 `terms.current` 标记，切换时在同一事务中先清除旧标记、再设置新标记，历史关系保留；尚无学期切换管理接口或自动调度。内容下架与采纳由对应业务路由校验，文件下载授权仍由组员4实现。

网站不发送邮件。普通成员忘记密码时联系管理员，由管理员在系统外核实身份后通过管理接口重置；唯一管理员忘记密码时，由具备数据库权限的运维人员使用外部重置命令。头像在替换或删除时立即清理，不复用、不保留历史，无头像登记表或定时清理命令。

参考：[Drizzle D1](https://orm.drizzle.team/docs/get-started/d1-new)、[D1 外键](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)、[Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)、[bcrypt.js 的 72 字节限制](https://github.com/dcodeIO/bcrypt.js#security-considerations)。