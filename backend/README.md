# 后端开发

当前提供 Workers / TypeScript / Drizzle / D1 后端，以及本地模拟 R2 绑定。业务进展和接口详见[账号与权限基础](../docs/组员1-账号与权限基础.md)。本轮基于 `main` 的提案重新实施，不依赖其他分支的代码或账号草案。

账号列表、禁用／恢复、身份与私有资料维护、管理员重置成员密码、公开名称与头像已实现，完整接口见[账号管理与资料接口](../docs/组员1-账号管理与资料接口.md)。

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

`admin:init:local` 在交互终端输入两次密码且不回显；初始化唯一管理员，再次执行会拒绝覆盖现有密码。至少 12 个字符且 UTF-8 不超过 72 字节。不要通过命令行参数或提交文件传入密码。没有预置密码，不需要首次登录强制改密。自动化测试使用隔离的虚构账号，不替你设置日常数据库的管理员密码。

管理员密码保存在 D1 的 bcrypt 散列中，不使用 Worker 环境变量或 Secret 作为登录密码。初始化、状态查询和外部重置命令见[管理员初始化与恢复](../docs/组员1-管理员初始化与恢复.md)。本地重置使用 `pnpm admin:reset:local`；通用命令必须明确选择 `--local` 或 `--remote --config <目标配置>`。写入前显示目标并要求输入确认文字。远程命令直接调用 Cloudflare D1 API，不依赖网站登录或维护用 Worker，需具备目标 D1 的写权限。

种子仅创建虚构教师、学生、课程和两个演示学期，没有登录凭据。首次种子将未配置的当前学期设为演示当前学期，重复执行不覆盖已选学期或已编辑的数据。种子不是正式账号导入工具。

开发、迁移、种子和管理员初始化共用 `backend/.wrangler/state`。管理员初始化和头像清理通过 Wrangler 代理访问其 `v3` 子目录，与 CLI 数据位置一致；脚本将文件 URL 转换为操作系统路径，支持 Windows 盘符、空格和中文目录。测试通过 Miniflare 启动临时 D1，退出销毁，不连接日常数据库。所有本地命令均使用 `local`，绑定名 `DB`、`FILES`；不读取凭据 CSV、不需要云端登录、不连接远程业务资源。

默认后端地址：`http://127.0.0.1:8787`。健康检查：

```sh
curl.exe --fail http://127.0.0.1:8787/api/health
```

上例适用于 Windows；macOS / Linux 使用 `curl`。响应：`{"data":{"status":"ok","environment":"local","database":"ok"}}`。健康检查验证 D1 连通性，业务使用前仍必须执行迁移。后端目前仅提供 API，直接访问根路径不会出现登录页面。

## 文件与协作入口

| 路径 | 用途 |
| --- | --- |
| `src/index.ts` | Worker 入口和错误响应 |
| `src/auth/` | 密码、会话、账号接口 |
| `src/accounts/` | 账号查询维护、资料、头像、修改审计 |
| `src/permissions.ts` | 管理员、当前授课教师、学籍查询 |
| `src/db/schema.ts` | 共享 Drizzle 表定义 |
| `migrations/` | 按编号追加的 D1 SQL 迁移 |
| `seed/local.sql` | 可重复执行的虚构关系数据 |
| `tests/` | 长期保留的账号、隐私、会话、管理员运维和 R2 回归测试 |
| `scripts/admin.mjs`、`scripts/lib/` | 独立管理员运维命令、终端输入和 D1 访问 |

SQL 迁移与 Drizzle schema 同步修改。已共享或已应用的迁移不改写，后续追加新编号；测试读取全部迁移后执行真实 D1 查询，不使用伪造数据库。`pnpm check` 只执行 TypeScript 静态检查，`pnpm test` 不执行项目完整构建。

## 前端联调

前端工程当前未包含在 main 中。组员 2 初始化后，浏览器使用相对地址 `/api/...`，开发代理保留 `/api` 路径、Cookie、Set-Cookie 和原始 Host。代理不得把 Host 改写为后端地址，否则来源检查会拒绝请求。生产需要同源反向代理，跨域部署另定配置。

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

所有写接口要求 `Origin` 与请求 URL 的 origin 完全一致；JSON 接口使用 `Content-Type: application/json`。Cookie 为 HttpOnly、SameSite=Strict，HTTPS 下加 Secure，前端不用读取 token 或将其保存到 localStorage。curl 等客户端测试写接口也要提供匹配的 Origin。管理员登录页与普通成员登录页使用不同接口。

## 环境边界与未完成项

本轮配置只包含可运行的 `local`，D1 ID 是本地占位符。云端 `dev`、生产 `coursestack.cn` 的资源绑定、部署、远程迁移、Secrets、CORS 和 CPU 配额验证分别作为后续任务处理，没有添加发布命令或连接云资源。R2 目前只用于头像，尚无课程资料上传下载接口。

当前后端已提供账号管理、资料维护和管理员重置成员密码接口；管理页面、名单导入和授课管理接口仍待完成。学期采用单一当前学期指针保存历史关系；尚无学期切换管理接口或自动调度。不要把底层权限查询当成完整的内容下架、采纳或文件下载授权。

网站不发送邮件。普通成员忘记密码时联系管理员，由管理员在系统外核实身份后通过管理接口重置；唯一管理员忘记密码时，由具备数据库权限的运维人员使用外部重置命令。`pnpm avatars:cleanup:local` 清理超过一小时的未引用头像。

参考：[Drizzle D1](https://orm.drizzle.team/docs/get-started/d1-new)、[D1 外键](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)、[Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)、[bcrypt.js 的 72 字节限制](https://github.com/dcodeIO/bcrypt.js#security-considerations)。