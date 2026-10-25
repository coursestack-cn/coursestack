# Deploying to the dev environment

This guide is written for team members and their coding agents. It covers deploying the current code to the shared cloud dev environment. Production is not set up for deployment yet; do not deploy it.

## What dev is

| Item | Value |
| --- | --- |
| URL | `https://dev.coursestack.cn` |
| Worker | `coursestack-dev` (`env.dev` in `backend/wrangler.json`) |
| D1 | `coursestack-db-dev` |
| R2 | `coursestack-files-dev` |
| `APP_ENV` | `dev` |

One Worker serves both the frontend and the API from the same origin, like `127.0.0.1:5173` does locally with the Vite proxy:

- `/api` and `/api/*` run the backend Worker. Unknown API paths return a JSON 404.
- Everything else is served from the built `frontend/dist`. Unknown page paths fall back to `index.html`.

Dev is shared by the whole team. Each deployment replaces the previous one, and the dev D1 holds shared test data.

## Domains and R2 CORS

The ops owner maintains the following domain mappings in Cloudflare Workers & Pages. Open each Worker, then **Settings > Domains & Routes**:

| Worker | Custom Domain |
| --- | --- |
| `coursestack` | `coursestack.cn` |
| `coursestack-dev` | `dev.coursestack.cn` |

Keep both the `workers.dev` entry and Version URLs / Preview URLs disabled. `backend/wrangler.json` records the Custom Domains and explicitly disables `workers_dev` and `preview_urls` for cloud deployments. The `local` environment overrides `routes` with an empty array so it does not inherit the production domain. Do not re-enable the old URLs during deployment.

Browser API calls continue to use `/api/...`. Session Cookies have no `Domain` attribute, and write requests require an exact match between `Origin` and the request URL origin. Do not share Cookies across the two domains or allow one environment's Origin to write to the other.

For each R2 bucket, open **R2 Object Storage > bucket > Settings > CORS Policy**, edit the existing policy in the JSON editor, and replace its origins with the following:

| Bucket | `AllowedOrigins` |
| --- | --- |
| `coursestack-files` | `["https://coursestack.cn"]` |
| `coursestack-files-dev` | `["https://dev.coursestack.cn"]` |

The complete dev policy for the dashboard is:

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

For the production bucket, use the same policy with `https://coursestack.cn` as the only origin. Remove the old `workers.dev` origins from both buckets. Saving this file or deploying the Worker does not apply the bucket policy; the ops owner must save it in the dashboard separately.

These CORS policies are for browser uploads to presigned R2 URLs. The current avatar API accesses `FILES` through the Worker and does not need bucket CORS. Local development uses simulated R2; add the exact local frontend origin to the dev bucket only when explicitly testing direct uploads from a local page to cloud R2. Keep R2 buckets private and keep presigned URLs on the existing R2 S3 endpoint; the application domains do not replace that endpoint.

References: [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/), [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

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
curl https://dev.coursestack.cn/api/health
```

Expected: `{"data":{"status":"ok","environment":"dev","database":"ok"}}`. Also check:

- `/api/does-not-exist` returns JSON 404 `NOT_FOUND`, not HTML.
- `/` returns the frontend page.
- Write requests from the page work. Write requests sent without a matching `Origin` header are rejected with `ORIGIN_DENIED`, which is expected.
- Session Cookies are host-only: `Set-Cookie` has no `Domain` attribute. Production and dev do not share a session Cookie.
- Both Workers still have their `workers.dev` and Version URLs / Preview URLs entries disabled after deployment.

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

- Production deployment, resource bindings, frontend assets, and CPU quota validation. The `coursestack.cn` Custom Domain is recorded, but the top-level configuration is not ready to deploy.
- R2 S3 credentials and Worker Secrets. The current backend does not use them.
- Automated deployment from CI.