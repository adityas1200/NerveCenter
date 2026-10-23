---
id: SPEC-platform-05
title: Configuration, environment loading, /health and /api/meta
status: implemented
area: platform
owners: []
code:
  - backend/src/config.mjs
  - backend/src/env-defaults.mjs
  - backend/src/runtime-env.mjs
  - backend/src/main.mjs
  - backend/src/bootstrap.mjs
  - backend/src/serve-ui.mjs
  - backend/src/ui/ui-server.mjs
  - backend/src/api/server.mjs
  - .env.defaults
  - deploy/.env.example
last_verified: 2026-10-03
---

# Configuration, environment loading, /health and /api/meta

## Purpose
Define how the backend assembles its configuration from process env, tracked defaults, AWS Secrets Manager and `backend/.env`, and the two unauthenticated introspection endpoints.

## Scope
- In scope: load order, `config` keys, production assertions, `/health`, `/api/meta`, UI-only server role.
- Out of scope: identity (identity-auth.md), storage (storage-migrations.md), per-feature env knobs.

## Actors and permissions
Operators set env; `/health` and `/api/meta` are anonymous.

## Requirements
- **FR-1** Boot order SHALL be: `applyEnvDefaults()` (fills only completely unset vars from the tracked `.env.defaults`, so deliberate blanks win), then `hydrateFromAwsSecrets()`, then `config.mjs` import (which also reads `backend/.env` for unset/empty keys unless `OPS_TEST_DATA_ROOT` is set).
- **FR-2** Secrets hydration SHALL run when `USE_AWS_SECRETS` is true, or `auto` and the deploy env (`BEACON_ENV|APP_ENV|NC_ENVIRONMENT|DEPLOY_ENV|ENV`) is a known AWS env; it SHALL read secret groups (`AWS_SECRET_GROUPS`, default `nervecenter,common`) under `<AWS_SECRET_PREFIX>/<env>/`, never overwrite existing non-placeholder env values unless `AWS_SECRETS_OVERRIDE`, expand alias groups (e.g. `db_host`/`DB_HOST`), and degrade to a log line on any error.
- **FR-3** `config.environment` SHALL be `production` iff `NODE_ENV=production`, `test` when `OPS_TEST_DATA_ROOT` is set, else `development`.
- **FR-4** Database settings SHALL be `DATABASE_URL`/`NC_DATABASE_URL` or built from `db_host/db_port/db_name/db_user/db_password`, with `postgresql+driver://` normalised; `NC_DB_SCHEMA`/`NERVECENTER_DB_SCHEMA` selects the schema. `metadataStore` defaults to `postgres` when a URL exists else `file`; `secretStore` defaults to `memory`.
- **FR-5** Other keys: `HOST` (127.0.0.1), `PORT` (8787), `OPS_PUBLIC_URL`, `OPS_CORS_ORIGIN` (`*`), `OPS_TICKET_PREFIX` (`OPS`), `OPS_APPROVER_ROUTING` JSON merged over defaults (invalid JSON ignored), `OPS_MAX_REQUEST_BYTES` (8 MiB), `OPS_MAX_UPLOAD_BYTES` (20 MiB), `s3_bucket`/`OPS_S3_BUCKET`, `NC_S3_PREFIX`, `AWS_REGION` (default `us-east-1`), `OPS_SECRET_ENCRYPTION_KEY`, `OPS_RECOVER_ON_BOOT=0` (skip task recovery and report backfill), `OPS_TICKET_POLLING=0`, `OPS_INTEGRATION_SYNC=0`, `OPS_ROUTINES=0`.
- **FR-6** `GET /health` SHALL return 200 `{ok:true, environment, metadataStore, secretStore, anthropicKeyPresent, databricks:{configured,ready,verified,source,configurationRequired}, claudeAgentSdkInstalled}`; it SHALL always be 200 (not a readiness probe) and never expose secret values.
- **FR-7** `GET /api/meta` SHALL return `{environment, identityMode, storage:{metadata,secrets}, application:{ticketPrefix, maxUploadBytes}}`.
- **FR-8** The UI-only entry (`serve-ui.mjs`) SHALL serve the built frontend, answer `/health` with `{ok:true, role:"ui"}`, never serve index.html for `/api` paths (404), accept `PUBLIC_BASE_PATH` with or without the prefix, fall back to index.html for extension-less paths, restrict to GET/HEAD, and refuse path escape.
- **FR-9** The backend SHALL resolve `WORKSPACE_DIR` (`OPS_WORKSPACE_DIR`), `RUNTIME_DIR` (`OPS_RUNTIME_DIR`) and `PLUGIN_DIR` (`OPS_PLUGIN_DIR`) from env with repo-relative defaults.

## Scenarios
### S1 Platform value wins
- **Given** the platform sets `NC_DB_SCHEMA=` (blank) and `.env.defaults` has `NC_DB_SCHEMA=nervecenter`
- **When** defaults load
- **Then** the blank is kept (`env-defaults.test.mjs`).

### S2 Health without Databricks
- **Given** no Databricks credentials
- **Then** `/health` is 200 with `databricks.configurationRequired: true` (`api.test.mjs`).

### S3 UI server API misroute
- **Given** the UI role
- **When** `/api/x` is requested
- **Then** 404 JSON, not the shell (`ui-server.test.mjs`).

## Interfaces
- HTTP: `GET /health`, `GET /api/meta` (see FR-6/7).
- Files: `.env.defaults` (repo root, copied into the image), `backend/.env` (local), `deploy/.env.example`.
- Env: see FR-5; `OPS_PG_SSL`, `OPS_PG_POOL_MAX` (storage spec).

## Non-functional constraints
`/api/meta` and `/health` disclose environment, identity mode and store types without auth. Hydration and defaults log only key names/counts.

## Known gaps / deviations
- **`.env.defaults` is tracked and contains live-looking secrets and personal identifiers**: `OPS_SECRET_ENCRYPTION_KEY`, `OPS_TRUSTED_IDENTITY_TOKEN`, admin ids/emails. Because `env-defaults` only fills unset vars, these become the production values on any stack that does not override them. Treat as a security issue.
- `/health` is always 200, so it cannot signal DB or workspace failure.
- `config.mjs` reads `backend/.env` after defaults/hydration, so `.env` can only fill still-empty keys; precedence is subtle and undocumented in code outside comments.
- `OPS_MAX_UPLOAD_BYTES` is exposed through `/api/meta` but not used by any upload path; limits are hard-coded elsewhere (see http-conventions.md).
- `docs/DESIGN.md` and README env tables were not reconciled with `deploy/.env.example`.
- Untested: secrets hydration, `config` derivation, `/api/meta`.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/main.mjs:1-8`, `backend/src/config.mjs:10-25` | `backend/tests/env-defaults.test.mjs:13,19,28` |
| FR-2 | `backend/src/runtime-env.mjs` (`shouldLoad`, `candidateExports`, `hydrateFromAwsSecrets`) | none |
| FR-3 | `backend/src/config.mjs:110` | none |
| FR-4 | `backend/src/config.mjs:49-62,155-156` | none |
| FR-5 | `backend/src/config.mjs:110-163`, `backend/src/main.mjs:25-33` | none |
| FR-6 | `backend/src/api/server.mjs:20-26,34` | `backend/tests/api.test.mjs:20` |
| FR-7 | `backend/src/api/server.mjs:35` | none |
| FR-8 | `backend/src/serve-ui.mjs`, `backend/src/ui/ui-server.mjs:27-62` | `backend/tests/ui-server.test.mjs:30-77` |
| FR-9 | `backend/src/config.mjs:27-32` | none |

## Open questions
- Should `/health` split liveness from readiness (DB reachable, workspace writable)?
