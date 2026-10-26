# Deploying CourseStack

This guide is written for team members and their coding agents. GitHub Actions deploys `main` to the shared dev environment after each push. Manual runs can deploy `main` to either dev or production.

## Deployment targets

| Item | Dev | Production |
| --- | --- | --- |
| URL | `https://dev.coursestack.cn` | `https://coursestack.cn` |
| Worker | `coursestack-dev` | `coursestack` |
| Wrangler environment | `dev` | `production` |
| D1 | `coursestack-db-dev` | `coursestack-db` |
| R2 | `coursestack-files-dev` | `coursestack-files` |
| `APP_ENV` | `dev` | `production` |

Both environments are defined in `backend/wrangler.json`. In each environment, one Worker serves both the frontend and the API from the same origin, like `127.0.0.1:5173` does locally with the Vite proxy:

- `/api` and `/api/*` run the backend Worker. Unknown API paths return a JSON 404.
- Everything else is served from the built `frontend/dist`. Unknown page paths fall back to `index.html`.

Dev is shared by the whole team. Each deployment replaces the previous one, and the dev D1 holds shared test data.

## GitHub Actions

The workflow is [Deploy Workers](../.github/workflows/deploy.yml).

### One-time repository setup

In **Settings > Secrets and variables > Actions**, add these **repository secrets** once. Dev and production share the same token and account; the workflow does not require GitHub Environments.

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The shared Cloudflare token authorized to deploy both Workers, bind their resources, manage their Custom Domains, and apply D1 migrations. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account containing both environments' Workers, D1 databases, R2 buckets, and domain. The ID is not sensitive, but the workflow reads it from Secrets too. |

Use the **Edit Cloudflare Workers** token template as a starting point, ensure it includes D1 write access, and restrict account and zone access to the project's resources. Never place the token in YAML or other repository files. The workflow passes credentials only to the settings check, migration, and deployment steps.

If `dev` and `production` were already created under **Settings > Environments**, add the two repository secrets above before removing those unused GitHub environments. The `environment` workflow input selects the Wrangler deployment target; it does not refer to a GitHub Environment. Production runs are started manually, without a GitHub Environment approval step.

The workflow must be merged into the default branch (`main`) before GitHub exposes **Run workflow**. Both apps and their lockfiles must also be present on `main`.

### Automatic and manual runs

- A push to `main`, including a merged PR, deploys to `dev`.
- To deploy manually, open **Actions > Deploy Workers > Run workflow**, select branch `main`, then choose `dev` or `production` in the `environment` dropdown. The default is `dev`.
- Runs on other branches are skipped because remote migrations must already be merged into `main`.

Each run installs the locked dependencies, checks backend types, runs backend tests, and checks/builds the frontend. Only after those steps pass does it apply pending D1 migrations and deploy the Worker with the frontend assets using an explicit `--env`. It then checks `/api/health` for the expected environment and database status, requests `/`, and records the commit and URL in the run summary.

Migration and deployment jobs are serialized per environment. A new push does not cancel an active deployment; GitHub keeps at most one pending run per concurrency group and replaces an older pending run with a newer one. Dev and production have separate groups.

Both targets apply pending migrations automatically. Review migrations before merging: a later deployment failure does not undo successful migrations, and rolling back the Worker does not restore database schema or data. Use changes compatible with the currently deployed code. The workflow does not seed the cloud databases, initialize administrators, or reset existing accounts.

References: [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [GitHub deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments), [D1 migrations](https://developers.cloudflare.com/d1/wrangler-commands/#migrations-apply).

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

## Before deploying from a local terminal

- Deploy from a branch that has the latest `main` merged in. Otherwise you roll back other people's work on dev.
- Tell the group before you deploy, especially if you are about to apply a new migration.
- Only apply migrations that are already merged into `main`. Remote migrations cannot be undone, and applied migration files must never be edited.
- Install dependencies in both apps: `pnpm install --frozen-lockfile` in `backend/` and in `frontend/`.

## Local terminal credentials

Deployment needs two environment variables:

| Variable | Notes |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret. Ask the ops owner for it privately. |
| `CLOUDFLARE_ACCOUNT_ID` | Not secret, but passed the same way. |

Rules for people and agents:

- For local commands, set them only in the current shell session. For GitHub Actions, use the repository secrets above. Never write them into tracked files, `.env` files that may be committed, frontend code, `VITE_*` variables, commit messages, PR text, or chat logs.
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

## Deploy dev from a local terminal

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

Always pass `--env dev` for these commands. Production uses the separate `--env production` configuration. Never use a plain `wrangler deploy`: the top-level configuration still has no resource bindings or frontend assets.

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

For production, use `--env production` in both commands. A new automatic dev deployment or manual production deployment will replace the rollback with the selected `main` commit again.

## Administrators

Each database needs its own administrator, initialized once by the ops owner after migrations are applied. See [管理员初始化与恢复](./组员1-管理员初始化与恢复.md); for dev, use a git-ignored `backend/.local/admin-dev.json` with the account ID and the dev D1 ID `8ce3c6c3-826f-482e-830b-72799eba4417`:

```bash
pnpm admin:init --remote --config .local/admin-dev.json
```

For production, use a separate `backend/.local/admin-production.json` with the production D1 ID `9f049258-be55-48da-9626-ef12750db253`. Do not reuse dev's target file. Administrator setup remains an interactive operation outside CI.

## Not covered yet

- Live production deployment verification and CPU quota validation. The production resource identifiers match the local resource inventory; verify access with the selected Cloudflare account before the first run.
- R2 S3 credentials and Worker Secrets. The current backend does not use them.