# Deploying to the dev environment

This guide is written for team members and their coding agents. It covers deploying the current code to the shared cloud dev environment. Production is not set up for deployment yet; do not deploy it.

## What dev is

| Item | Value |
| --- | --- |
| URL | `https://coursestack-dev.ljm12914.workers.dev` |
| Worker | `coursestack-dev` (`env.dev` in `backend/wrangler.json`) |
| D1 | `coursestack-db-dev` |
| R2 | `coursestack-files-dev` |
| `APP_ENV` | `dev` |

One Worker serves both the frontend and the API from the same origin, like `127.0.0.1:5173` does locally with the Vite proxy:

- `/api` and `/api/*` run the backend Worker. Unknown API paths return a JSON 404.
- Everything else is served from the built `frontend/dist`. Unknown page paths fall back to `index.html`.

Dev is shared by the whole team. Each deployment replaces the previous one, and the dev D1 holds shared test data.

## Before you deploy

- Deploy from a branch that has the latest `main` merged in. Otherwise you roll back other people's work on dev.
- Tell the group before you deploy, especially if you are about to apply a new migration.
- Only apply migrations that are already merged into `main`. Remote migrations cannot be undone, and applied migration files must never be edited.
- Install dependencies in both apps: `pnpm install --frozen-lockfile` in `backend/` and in `frontend/`.

## Credentials

Deployment needs two environment variables:

| Variable | Notes |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret. Ask the ops owner for it privately. |
| `CLOUDFLARE_ACCOUNT_ID` | Not secret, but passed the same way. |

Rules for people and agents:

- Set them only in the current shell session. Never write them into tracked files, `.env` files that may be committed, frontend code, `VITE_*` variables, commit messages, PR text, or chat logs.
- Never print the token. Do not `echo` it, and do not run commands that dump the environment.
- `wrangler login` is not needed and should not be used for this.

PowerShell:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "<account id>"
$env:CLOUDFLARE_API_TOKEN = Read-Host -MaskInput "Cloudflare API token"
```

Bash:

```bash
export CLOUDFLARE_ACCOUNT_ID="<account id>"
read -rs -p "Cloudflare API token: " CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
```

Set `CI=1` as well when an agent runs the commands, so Wrangler does not wait for interactive prompts.

## Deploy

1. Apply new migrations. Skip this step if `main` added none since the last deployment. Run in `backend/`:

    ```bash
    pnpm exec wrangler d1 migrations apply DB --env dev --remote
    ```

2. Build the frontend. Run in `frontend/`. This is the only case where the project's no-full-build rule is lifted, because the Worker serves `frontend/dist`:

    ```bash
    pnpm build
    ```

3. Deploy the Worker together with the frontend assets. Run in `backend/`:

    ```bash
    pnpm exec wrangler deploy --env dev
    ```

Always pass `--env dev`. A plain `wrangler deploy` targets the top-level configuration, which would overwrite the production Worker `coursestack` with a Worker that has no bindings.

## Verify

```bash
curl https://coursestack-dev.ljm12914.workers.dev/api/health
```

Expected: `{"data":{"status":"ok","environment":"dev","database":"ok"}}`. Also check:

- `/api/does-not-exist` returns JSON 404 `NOT_FOUND`, not HTML.
- `/` returns the frontend page.
- Write requests from the page work. Write requests sent without a matching `Origin` header are rejected with `ORIGIN_DENIED`, which is expected.

Report what you deployed (branch and commit), whether you applied migrations, and the verification results.

## Rolling back

```bash
pnpm exec wrangler deployments list --env dev
```

```bash
pnpm exec wrangler rollback --env dev
```

Rollback only restores the Worker code and assets. It does not revert D1 migrations or data.

## Administrator on dev

The dev database needs its own administrator, initialized once by the ops owner. See [管理员初始化与恢复](./组员1-管理员初始化与恢复.md); use a git-ignored `backend/.local/admin-dev.json` with the account ID and the dev D1 ID `8ce3c6c3-826f-482e-830b-72799eba4417`:

```bash
pnpm admin:init --remote --config .local/admin-dev.json
```

## Not covered yet

- Production deployment, the `coursestack.cn` custom domain, and the top-level production configuration.
- R2 S3 credentials and Worker Secrets. The current backend does not use them.
- Automated deployment from CI.