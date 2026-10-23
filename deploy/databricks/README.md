# Deploying NerveCenter as a Databricks App

NerveCenter runs inside a customer's Databricks workspace as a single Databricks App. The code is the
same code the AWS/EC2 stack runs. At boot, `OPS_PLATFORM=databricks` picks the Databricks adapter for
each capability:

| Capability | AWS / EC2 stack | Databricks App |
|---|---|---|
| Tickets, tasks, inbox, RBAC (Postgres) | RDS, static password | **Lakebase**, a short-lived OAuth token per connection |
| Agent workspace mirror (operations.yaml, knowledge/, skills, task files) | S3 | **Unity Catalog volume**, through the Files API |
| Connector credentials saved in the UI | AWS Secrets Manager | AES-256-GCM encrypted rows in Lakebase (`ops_secrets`) |
| Deployment secrets (Anthropic key, encryption key) | Secrets Manager hydration | **Secret scope**, bound as app resources |
| Who the user is | Central Azure SSO / nginx gateway | **Databricks Apps proxy** (`X-Forwarded-Email`) |
| Frontend | nginx container | served by the backend (`OPS_FRONTEND_DIR`) |
| Port | 8787 | `DATABRICKS_APP_PORT` |

The code lives in:

- `backend/src/config.mjs`: platform detection and defaults.
- `backend/src/platform/databricks-app.mjs`: the app's own service principal and Lakebase tokens.
- `backend/src/storage/object-store.mjs`: S3 and volume stores.
- `backend/src/secrets/secret-store.mjs`: `PostgresSecretStore`.
- `backend/src/app/identity.mjs`: `databricks-apps` mode.
- `backend/src/lib/static.mjs`: serving the frontend.

The files in this folder:

| File | Purpose |
|---|---|
| `build.sh` | Stages the app into `.stage/`: backend, built frontend, plugin, `app.yaml`, `requirements.txt` |
| `app.yaml` | Runtime command and environment. `valueFrom` keys point at the app resources |
| `databricks.yml` | Bundle: the app, its compute size, and the four resources it binds |
| `requirements.txt` | Python for agent sessions: `uv`/`uvx` for MCP servers, plus the document-skill libraries |
| `ci-deploy.sh` | CI: `build.sh`, then `bundle validate`/`deploy`/`run`. Run by `deploy/buildspec.yml` when `DEPLOY_PLATFORM=databricks` |

---

## 0. Prerequisites

- A workspace with **Databricks Apps**, **Lakebase** and **Unity Catalog** enabled. You need rights to
  create an app, a database instance, a volume and a secret scope. Otherwise ask a workspace admin
  to do steps 1–3.
- On the machine you deploy from:
  - Databricks CLI (a recent version; this was written against v1.4).
  - Node 22 and npm.
  - Python 3 (used by `build.sh` to stamp `app.yaml`).
- An Anthropic API key.
- Signed in to the CLI:

```bash
databricks auth login --host https://<workspace-host> --profile nervecenter
export DATABRICKS_CONFIG_PROFILE=nervecenter
```

The examples use catalog `main`, schema `ops`, instance `nervecenter-db` and scope `nervecenter`.
Substitute your own.

## 1. Create the Lakebase database

**Lakebase Provisioned** (what `databricks.yml` binds by default):

```bash
databricks database create-database-instance nervecenter-db --capacity CU_1
```

The instance comes with a `databricks_postgres` database. NerveCenter creates its own `nervecenter`
schema inside it on first boot (`NC_DB_SCHEMA`) and runs its migrations there, so the database can be
shared with other apps.

**Lakebase Autoscaling** instead:

1. Create a project and branch (`databricks postgres ...` or the UI).
2. In `databricks.yml`, replace the `database` resource with:
   ```yaml
   - name: database
     postgres:
       branch: projects/<project>/branches/<branch>
       database: databricks_postgres
       permission: CAN_CONNECT_AND_CREATE
   ```
3. Build with `LAKEBASE_INSTANCE_NAME=` (empty). The backend then signs in with the service
   principal's workspace OAuth token instead of an instance-scoped credential.

## 2. Create the volume for the agent workspace

```bash
databricks schemas create ops main            # skip if the schema exists
databricks volumes create main ops nervecenter MANAGED
```

Local disk inside a Databricks App is wiped on every redeploy or restart. NerveCenter restores the
workspace from `/Volumes/main/ops/nervecenter/nervecenter/workspace/` at boot and pushes changes back
every 60 seconds (`OPS_WORKSPACE_SYNC_SECONDS`), plus once more on shutdown.

- Use any catalog, schema and volume you like. The bundle's `volume` variable takes
  `catalog.schema.volume`; quote it when the catalog name contains a hyphen.
- Creating a managed volume writes to the catalog's cloud storage. A `403 Forbidden ... from cloud
  storage provider` means the catalog's storage credential can't be written to, which a Unity Catalog
  `GRANT` can't fix; use another catalog or ask the metastore admin.
- When you deploy the app, its service principal is bound to the volume. The deployer must be able to
  grant that: `USE CATALOG` on the volume's catalog has to be held by all account users, or the
  deployer needs `MANAGE` on the catalog. Otherwise the deploy fails with `PERMISSION_DENIED`.
- No volume yet? Skip this step and deploy with `-t trial` (step 5). The workspace then lives on local
  disk only and is lost on every restart.

## 3. Create the secret scope and the two deployment secrets

```bash
databricks secrets create-scope nervecenter
databricks secrets put-secret nervecenter anthropic-api-key --string-value "sk-ant-..."
databricks secrets put-secret nervecenter secret-encryption-key --string-value "$(openssl rand -hex 32)"
```

- `secret-encryption-key` encrypts every connector credential (Jira, ServiceNow, Snowflake, Git
  tokens) that people save from the Connectors page. Those credentials are stored in Lakebase.
  **Do not rotate or lose this key.** If it changes, the saved credentials can no longer be read and
  have to be re-entered.
- Secret scopes can't serve as the store for these UI-saved credentials: a Databricks App reads a
  scope only through resources bound at deploy time, and the REST secret-read API is DBUtils-only.

## 4. Build the app

From the repository root:

```bash
LAKEBASE_INSTANCE_NAME=nervecenter-db \
OPS_ADMIN_USER_IDS=you@company.com,teammate@company.com \
./deploy/databricks/build.sh
```

- `OPS_ADMIN_USER_IDS` lists the people who are admins from their first sign-in, by workspace email.
  Everyone else starts as a developer, and admins can promote them in Settings.
- The script builds the frontend with `VITE_AUTH_MODE=platform`. This mode has no Azure SSO redirect;
  the user comes from `/api/me`.
- The script writes `deploy/databricks/.stage/`, which is git-ignored and rebuilt on every run.
- For a deploy without a volume (`-t trial`), set `NC_NO_VOLUME=1` so `app.yaml` doesn't reference the
  volume resource.

## 5. Deploy

```bash
cd deploy/databricks
databricks bundle deploy -t dev --var volume=main.ops.nervecenter
databricks bundle run nervecenter -t dev
```

Override the other defaults the same way if yours differ: `--var app_name=...`,
`--var lakebase_instance=...`, `--var lakebase_database=...`, `--var secret_scope=...`,
`--var compute_size=MEDIUM`.

Targets: `dev` and `prod` bind the volume (the `volume` variable is required); `trial` binds no
volume and needs no `--var volume`. Build with `NC_NO_VOLUME=1` before deploying `-t trial`:

```bash
databricks bundle deploy -t trial
databricks bundle run nervecenter -t trial
```

For production, use `-t prod`. In `mode: production` the bundle wants a `root_path` and `run_as`
pinned to a service principal; add them under `targets.prod` for your workspace.

On deploy the platform runs `npm install` (from `package.json`) and
`pip install -r requirements.txt`, then starts `node dist/main.mjs`.

**From CI.** Point the CodeBuild project at `deploy/buildspec.yml` (the same one the AWS
environments use) and set `DEPLOY_PLATFORM=databricks`; it runs `ci-deploy.sh`, which does steps 4
and 5. The build image needs Node 22, Python 3 and `curl` (the Databricks CLI is installed when
missing). Variables:

| Variable | Example | Purpose |
|---|---|---|
| `DEPLOY_PLATFORM` | `databricks` | Picks this folder in `deploy/buildspec.yml` |
| `DATABRICKS_HOST` | `https://<workspace-host>` | Target workspace |
| `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET` | service principal OAuth secret | CLI auth (or `DATABRICKS_TOKEN`); keep them in Secrets Manager, not plain variables |
| `DATABRICKS_BUNDLE_TARGET` | `dev` / `prod` | Bundle target (default `dev`) |
| `BUNDLE_VAR_volume` | `main.ops.nervecenter` | Required; any other bundle variable works the same way, e.g. `BUNDLE_VAR_app_name` |
| `LAKEBASE_INSTANCE_NAME`, `OPS_ADMIN_USER_IDS` | as in step 4 | Stamped into `app.yaml` |
| `DATABRICKS_CLI_VERSION` | `0.260.0` | Optional CLI pin |

**Without bundles** (quick try-out):

```bash
databricks sync deploy/databricks/.stage /Workspace/Users/<you>/apps/nervecenter --exclude node_modules
databricks apps create nervecenter
# Add the four resources in the UI (Compute > Apps > nervecenter > Edit), with the keys
# database, workspace-volume, anthropic-api-key, secret-encryption-key.
databricks apps deploy nervecenter --source-code-path /Workspace/Users/<you>/apps/nervecenter
```

## 6. Grant the app's service principal what it needs

Each app runs as its own service principal (shown on the app's page). The bundle's resources grant:

- `CAN_CONNECT_AND_CREATE` on the Lakebase database.
- `WRITE_VOLUME` on the volume.
- `READ` on the two secrets.

Two more grants are usually needed:

```sql
-- Unity Catalog: reach the volume's parents.
GRANT USE CATALOG ON CATALOG main TO `<app-service-principal-application-id>`;
GRANT USE SCHEMA  ON SCHEMA  main.ops TO `<app-service-principal-application-id>`;
```

The platform also injects `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET`.
NerveCenter therefore treats **the hosting workspace as its Databricks connection**: the Connectors
page shows it as "from deployment". Pipelines, Data Quality and the agent's Databricks tools see
exactly what the service principal is allowed to see. Grant it `CAN VIEW` / `CAN MANAGE RUN` on the
jobs it should monitor, `CAN USE` on a SQL warehouse, and `SELECT` on the tables it checks. To point
at a different workspace, save a Databricks connection on the Connectors page; a saved connection
wins over the deployment one.

## 7. Let people in

```bash
databricks apps update-permissions nervecenter --json '{"access_control_list":[{"group_name":"data-ops","permission_level":"CAN_USE"}]}'
```

Open the app URL from `databricks apps get nervecenter`. The Apps proxy signs people in with the
workspace's identity provider. NerveCenter reads the user's email from `X-Forwarded-Email` and
lowercases it, which makes it the user id. That matches how central SSO ids look, so RBAC records
carry over.

## 8. Check it

- `https://<app-url>/health` should show `"metadataStore": "postgres"`, `"secretStore": "postgres"`
  and `"anthropicKeyPresent": true`.
- `databricks apps logs nervecenter` should include:
  ```
  NerveCenter backend listening on http://0.0.0.0:8000 (identity=databricks-apps, store=postgres, workspace=/tmp/nervecenter/workspace, synced to /Volumes/main/ops/nervecenter/nervecenter/workspace/)
  ```
- After a minute of use, files should appear under `/Volumes/main/ops/nervecenter/nervecenter/workspace/`
  (Catalog Explorer).
- Redeploy and confirm the settings and knowledge are still there.

---

## Environment reference (Databricks-specific)

| Variable | Default on Databricks | Meaning |
|---|---|---|
| `OPS_PLATFORM` | auto: `databricks` when `DATABRICKS_APP_PORT` is set | Picks the platform defaults below |
| `OPS_IDENTITY_MODE` | `databricks-apps` | User from the Apps proxy headers |
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` | injected by the `database` resource | Lakebase connection |
| `OPS_DB_AUTH` | `databricks-oauth` (`password` if `PGPASSWORD` is set) | How Postgres connections authenticate |
| `NODE_EXTRA_CA_CERTS` | unset | Optional path to a mounted PEM CA bundle when the Lakebase server certificate is not trusted by Node's default roots |
| `OPS_PG_SSL` | TLS with certificate verification | `disable` is rejected in this deployment |
| `LAKEBASE_INSTANCE_NAME` | from `build.sh` | Provisioned instance for scoped credentials. Empty = workspace OAuth token |
| `NC_DB_SCHEMA` | `nervecenter` | Schema all NerveCenter tables live in |
| `OPS_OBJECT_STORE` | `volume` | `volume` or `s3` |
| `OPS_VOLUME_PATH` | from the `workspace-volume` resource | `catalog.schema.volume` or `/Volumes/c/s/v` |
| `NC_S3_PREFIX` | `nervecenter` | Folder inside the volume (the name is shared with S3) |
| `OPS_SECRET_STORE` | `postgres` | `postgres`, `aws`, `file`, `memory` |
| `OPS_SECRET_ENCRYPTION_KEY` | from the `secret-encryption-key` resource | Key for `ops_secrets` |
| `OPS_FRONTEND_DIR` | `web` | Built frontend the backend serves |
| `OPS_CORS_ORIGIN` | origin of `DATABRICKS_APP_URL` | Only needed if the platform doesn't inject the app URL |
| `USE_AWS_SECRETS` | `false` (always skipped on Databricks) | AWS Secrets Manager hydration |

The EC2/AWS stack is unchanged. None of these defaults apply unless the process runs as a Databricks
App or has `OPS_PLATFORM=databricks`.

## Known limits and things to check per customer workspace

- **Outbound network.** Agent sessions call `api.anthropic.com`. On deploy the platform pulls from the
  npm registry and PyPI. The default MCP servers are started with `uvx`/`npx`, which download packages
  on first use. Workspaces with serverless egress controls must allow these hosts, or use an internal
  mirror (`npm_config_registry`, `PIP_INDEX_URL`, `UV_INDEX_URL` in `app.yaml`).
- **No system packages.** Databricks Apps can't `apt-get`, so LibreOffice and poppler aren't there.
  The document skills can still build .docx/.xlsx/.pptx files, but can't convert them to PDF,
  recalculate workbooks in LibreOffice, or render pages to images.
  - Git: check that `git` exists in the app runtime (`databricks apps logs` after adding a Git
    knowledge base). Without it, Git knowledge bases and the source mirror can't clone.
- **One instance.** The ticket poller, routine scheduler and workspace mirror assume a single
  process. Don't scale the app beyond one instance.
- **Compute.** Each agent session is a Claude Code process. The bundle asks for `LARGE`, and `app.yaml`
  limits concurrency to `OPS_MAX_CONCURRENT_TASKS=2`. Raise it only on a bigger size.
- **Mirror lag.** The workspace is pushed every 60 s and on SIGTERM. A hard crash can lose up to that
  much of workspace-file edits. Tickets, tasks and secrets are in Lakebase and aren't affected.
- **Signing out.** The Databricks workspace owns the session. The sidebar's "Sign out" reloads the
  app; to really sign out, sign out of Databricks.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `password authentication failed` / `Lakebase returned no database credential` | Wrong `LAKEBASE_INSTANCE_NAME`, or the `database` resource isn't bound (check that `PGHOST` is in the app's environment) |
| `permission denied for database` / `for schema` | The app's service principal lacks `CAN_CONNECT_AND_CREATE`; rebind the `database` resource |
| `Databricks GET /api/2.0/fs/directories... failed (403)` | Missing `WRITE_VOLUME`, or `USE CATALOG`/`USE SCHEMA` on the volume's parents |
| `Cannot add volume ... lack USE CATALOG ... does not have MANAGE` on `bundle deploy` | The deployer can't grant the app's service principal access to the volume's catalog; see step 2 |
| `OPS_SECRET_STORE=postgres requires OPS_SECRET_ENCRYPTION_KEY` | The `secret-encryption-key` resource or secret is missing |
| `Production requires an explicit OPS_CORS_ORIGIN` | The runtime didn't inject `DATABRICKS_APP_URL`; set `OPS_CORS_ORIGIN` to the app URL in `app.yaml` |
| `401 The Databricks Apps proxy did not forward a user identity` | Something is calling the app port directly, not through the app URL |
| App starts, agent tasks fail at once | `ANTHROPIC_API_KEY` missing (`/health` → `anthropicKeyPresent`), or `api.anthropic.com` is blocked |
