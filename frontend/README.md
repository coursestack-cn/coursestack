# 前端开发

组员 2 的主站前端工程，使用 Svelte 5、Vite 8 和 TypeScript 6。依赖、锁文件、工具和编辑器配置均位于 `frontend/`，前端独立安装和运行，通过 HTTP 接口对接后端。

当前已初始化前端基础工程，后端工程尚未初始化。本文集中说明前端技术栈、环境配置和开发方式，具体实现以本目录代码和配置为准。项目总介绍见[项目 README](../README.md)。

## 工具与启动

使用 Node.js 22.12 及以上的 22.x 版本，或 Node.js 24 及以上版本；包管理器固定为 pnpm 12.5.1。当前 svelte-check 的 TypeScript 支持范围包含 5 和 6，升级 TypeScript 主版本前需重新核对。

从仓库根目录进入前端目录后执行：

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

打开 http://127.0.0.1:5173。修改源文件后由 Vite 热更新；按 Ctrl+C 停止服务。端口被占用时启动会报错，不会自动改用其他端口。

| 命令（在前端目录执行） | 作用 |
| --- | --- |
| `pnpm dev` | 启动前端开发服务器 |
| `pnpm check` | 检查 Svelte、前端 TypeScript 及开发工具配置，不生成构建产物 |
| `pnpm build` | 类型检查后生成前端生产文件到 `frontend/dist/` |
| `pnpm preview` | 在 4173 端口预览已有的生产文件，需要先生成构建产物 |

## 文件入口

- `package.json`、`pnpm-lock.yaml`：前端依赖、版本要求和开发命令。
- `pnpm-workspace.yaml`：仅保存本前端的 pnpm 设置，未纳入其他项目。
- `.editorconfig`、`.gitignore`、`.vscode/`：前端格式、忽略规则与编辑器配置。
- `index.html`：HTML 入口与应用挂载节点。
- `src/main.ts`：挂载 Svelte 应用。
- `src/App.svelte`：主站页面入口。
- `src/app.css`：全局样式。
- `vite.config.ts`：开发服务器与接口代理。
- `tsconfig.json`、`tsconfig.node.json`：浏览器代码与工具配置分别检查。

## 接口联调

本地约定前端使用 `/api` 前缀请求接口。开发服务器默认把 `/api` 和 `/api/...` 转发到 `http://127.0.0.1:8787`，保留完整路径和查询参数，例如 `/api/courses?page=1` 转发到 `http://127.0.0.1:8787/api/courses?page=1`。

该端口和路径前缀是前端的初始联调配置，实际接口需与组员 1、3、4 约定。仓库尚未提供后端服务；没有后端时页面仍可启动，接口请求会失败。

需要修改后端地址时，将 `.env.example` 复制为本目录下的 `.env.local`，修改 `DEV_API_TARGET` 后重启开发服务器。`.env.local` 已被 Git 忽略，示例配置保留在仓库。

代理仅在开发服务器中生效。生产环境需由部署配置将同源 `/api` 请求路由到后端。Cloudflare 账号、D1、R2、登录会话及真实密钥由对应后端和运维负责人配置；纯前端开发无需先登录 Cloudflare。不要把密钥放入前端代码或 `VITE_*` 环境变量，后者会进入浏览器代码。

## 编辑器

用 VS Code 直接打开 `frontend/` 目录，安装推荐的 Svelte 扩展。该目录的工作区配置包含 TypeScript SDK 路径、UTF-8、LF 和文件末尾不追加换行。仅打开仓库根目录时，VS Code 不会自动加载子目录中的 `.vscode/` 配置。

使用 TypeScript 版本选择命令选择工作区版本；需要时重启 TypeScript 或 Svelte 语言服务。

参考：[Vite 入门](https://vite.dev/guide/)、[开发代理](https://vite.dev/config/server-options#server-proxy)、[环境变量](https://vite.dev/guide/env-and-mode)、[Svelte 文档](https://svelte.dev/docs/svelte/overview)。