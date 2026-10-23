# NerveCenter AWS deployment

Two containers built from `deploy/aws/Dockerfile` (build context: the repository root, so `docker build -f deploy/aws/Dockerfile --target backend .`) and run with Docker Compose on an EC2 host through CodeBuild and Systems Manager: an nginx frontend serving the Vite build, and one Node backend that hosts the API, the Claude Agent SDK sessions (with the vendored `plugin/operations-fleet`), the ticket poller and the routine scheduler.

To run inside a customer's Databricks workspace instead (Lakebase, a Unity Catalog volume, the Apps proxy for sign-in), see [../databricks/README.md](../databricks/README.md).

| File | Purpose |
|---|---|
| `Dockerfile` | `frontend` (nginx) and `backend` (Node) images |
| `docker-compose.yml` | The two services on the EC2 host; `docker-compose.v2.override.yml` renames them for a side-by-side stack |
| `nginx.conf`, `nginx-env-defaults.envsh` | Frontend container config |
| `ci-deploy.sh` | CI, bundle mode (default): zip, S3, atomic swap on the host, then `ec2/deploy-component.sh` |
| `ci-deploy-git.sh` | CI, git mode (`AWS_DEPLOY_MODE=git`): the host checkout pulls the branch and rebuilds |
| `ec2/deploy-component.sh` | Runs on the host: loads env, rebuilds and restarts the Compose service(s), health check |
| `.env.example`, `.env.replacement` | Templates for the host's `deploy/aws/.env` |

## What the backend needs

| Concern | Where it lives | Notes |
|---|---|---|
| Tickets, tasks, inbox | Postgres (shared dataverse RDS) | `OPS_METADATA_STORE=postgres`, `NC_DATABASE_URL` or `db_*`, `NC_DB_SCHEMA` pins the `ops_*` tables to a schema |
| Agent workspace | Docker volume `nervecenter-workspace`, mirrored to `s3://<bucket>/<prefix>/workspace/` | Restored on boot when the volume is empty, pushed every `OPS_WORKSPACE_SYNC_SECONDS` |
| Credentials | AWS Secrets Manager | `OPS_SECRET_STORE=aws`. Connector secrets are written by the app under `connectors/<id>/<ENV>`; `operations.yaml` only holds `${ENV}` references |
| Model key | `beacon/<env>/common` secret (`anthropic_api_key`) | Hydrated by `runtime-env.mjs` at boot |
| Identity | Central Azure SSO | Backend forwards the browser cookie to `OPS_SSO_SESSION_URL`; browser identity headers are ignored |

The backend image includes `git` (Knowledge clones, the plugin's build skill), `python3` and `uv` (the default MCP servers Connectors configures run with `uvx`), and Node's `npx`. The first task that uses an MCP server downloads it into the `nervecenter-uv` volume.

## Pipeline variables

The CodeBuild project's buildspec is `deploy/buildspec.yml`, shared with Databricks.

| Variable | Frontend value | Backend value | Purpose |
|---|---|---|---|
| `DEPLOY_PLATFORM` | `aws` | `aws` | Picks `deploy/aws/` in `deploy/buildspec.yml` (the default when unset) |
| `AWS_DEPLOY_MODE` | `bundle` or `git` | same | `bundle` (default) runs `ci-deploy.sh`; `git` runs `ci-deploy-git.sh`, which also needs `BRANCH_NAME` |
| `COMPONENT` | `frontend` | `backend` | Compose service rebuilt by the stage |
| `HEALTH_URL` | `http://localhost:8420/` | `http://localhost:8421/health` | Post-deploy health check |
| `BUCKET_NAME` | same deployment bucket | same deployment bucket | Source archives and deployment backups |
| `ENVIRONMENT` | deployment name | deployment name | Artifact path and deploy label |
| `TARGET_INSTANCE_ID` | target EC2 ID | target EC2 ID | Systems Manager target |
| `TARGET_PATH` | repository path | repository path | Atomic deployment directory |
| `PUBLIC_BASE_PATH` | `/apps/nervecenter` | same | Frontend base and API prefix |

Use `COMPONENT=nervecenter` to rebuild both services in one stage.

## EC2 preparation

The instance needs Docker Engine, Docker Compose v2, AWS CLI, `unzip` and `curl`. The instance role needs the deployment artifact bucket, Systems Manager, Secrets Manager read/write under the NerveCenter prefix, S3 read/write under `<prefix>/workspace/`, and network access to the RDS instance.

Create the preserved environment file once:

```sh
mkdir -p /path/to/nervecenter/deploy/aws
cp deploy/aws/.env.example deploy/aws/.env
chmod 600 deploy/aws/.env
```

The deployment preserves `deploy/aws/.env` and never replaces it from source control. A host set up before the move to `deploy/aws/` keeps its old `deploy/.env`; the first deploy copies it to `deploy/aws/.env` when that file sets nothing. The EC2 deploy script generates and persists a random `OPS_TRUSTED_IDENTITY_TOKEN` when the value is absent, empty or still the example placeholder.

## First boot

1. Sign in. Users in `OPS_ADMIN_USER_IDS` are admins; everyone else is a developer until an admin promotes them under Settings > Users & roles.
2. Settings > Team: name and timezone (routine schedules use it).
3. Connectors: connect Databricks, Jira or ServiceNow, Snowflake. Each form stores the secret in Secrets Manager and writes the MCP entry the agent uses. Test from the card.
4. Settings > Ticketing: add a source per ticket platform, decide whether new tickets start a triage task automatically and what the agent may do on its own.
5. Knowledge: add the runbooks repository. Skills: upload any custom skill zips.
6. Open Tasks > New task and give the agent something to do. Writes wait in the Inbox for approval.

Everything from steps 2 to 5 lands in `operations.yaml` and the workspace folders, which the S3 mirror keeps across redeploys.

## Trusted identity boundary

Centralized Azure SSO is the deployment default. Sandbox uses the Dataverse shared auth route, `/dataverse/apps/api/v1/auth/*`, as used by AI-for-Data; this is not proxied by the NerveCenter frontend container. Set `OPS_SSO_SESSION_URL` to that service's server-to-server `/session` endpoint. The backend forwards the browser's HTTP-only cookie and uses only the verified user returned by that service.

`trusted-gateway` remains available for deployments with an external gateway that injects the identity contract itself. In that mode the frontend nginx container overwrites `x-user-id`, `x-user-name` and `x-ops-trusted-identity` with the configured identity and internal token; caller-supplied identity headers are never forwarded, and direct calls to the backend port still require the credential. Production startup rejects `single-user` and `development` identity modes.

## Local development

No containers: run `npm run build` and `npm start` in `backend/`, then `npm run dev` in `frontend/`. For backend source watching, run `npm run dev` in `backend/` instead of the build/start pair. Files replace Postgres and S3 (`backend/data/runtime/`, `backend/workspace/`, both untracked); with `OPS_SECRET_STORE=file` secrets persist in `backend/data/runtime/secrets.json`, otherwise they stay in memory for the process. Connectors, Knowledge and Settings write the same workspace files as production. Run one backend per workspace.

### Page refresh interval

Set `VITE_AUTO_REFRESH_SECONDS` in the Compose environment before building the frontend (default 300 seconds; 0 disables). Compose forwards it to the frontend Docker build; direct Docker builds use `--build-arg VITE_AUTO_REFRESH_SECONDS=300`. The Dockerfile leaves an omitted argument empty so Vite can read `.env.defaults`. Rebuild/redeploy the frontend when changing it. This does not control backend source synchronization or the separate 15-second notification poll.
