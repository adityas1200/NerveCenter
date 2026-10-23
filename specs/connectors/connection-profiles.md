---
id: SPEC-connectors-03
title: Connection profiles and provider resolution
status: implemented
area: connectors
owners: []
code:
  - backend/src/connections/connection-service.mjs
  - backend/src/connections/connection-profile-store.mts
  - backend/src/api/server.mjs
  - backend/src/app/rbac.mjs
last_verified: 2026-10-03
---

# Connection profiles and provider resolution

## Purpose
Data pages (Pipelines, Data Quality, Tickets, Overview) need a direct client to Databricks, ServiceNow, Jira and Snowflake. A connection profile stores non-secret config plus a reference to credentials in the secret store, and `resolve(provider)` picks the profile (or deployment env vars) the services use.

## Scope
- In scope: `ConnectionService`, profile stores (file / Postgres), `/api/connections*` and `/api/connection-*` routes.
- Out of scope: how services use the clients; connector cards (SPEC-connectors-01/02); the store itself (SPEC-connectors-04).

## Actors and permissions
`POST/PUT/DELETE /api/connections`, `/api/connections/:id`, `/api/connections/:id/set-default` are admin-only (`rbac.mjs:60`). The regex does not match `/api/connections/:id/test`, so testing is allowed for any role that reaches the route (see gaps). GETs are open to authenticated users.

## Requirements
- **FR-1** The provider templates SHALL be `databricks`, `servicenow`, `jira`, `snowflake`, all `state:'available'`, each with its non-secret fields (`GET /api/connection-templates`).
- **FR-2** `save` SHALL reject an unknown provider (`Unsupported connection provider`), an id not matching `^[a-z0-9][a-z0-9-]{2,80}$`, and any missing required config field (`<label> is required`). Blank config values are dropped.
- **FR-3** `save` SHALL normalize the endpoint: Databricks host via `normalizeOrigin`, ServiceNow instance via `normalizeServiceNowInstance`, Jira site via `normalizeJiraSite`.
- **FR-4** With `credentialSource` `direct` (default) and an object `credentials`, `save` SHALL validate it per provider and store it JSON-encoded at secret ref `connections/<id>/credentials`; the profile record SHALL hold only the ref, never the credentials.
- **FR-5** Credential validation SHALL require: Databricks a token (`token|pat|accessToken`) or both `clientId` and `clientSecret`; ServiceNow username and password (or token); Jira `apiToken|token`; Snowflake `authType` of `key_pair` or `password`, plus username and the matching private key / password.
- **FR-6** A new profile without credentials SHALL be rejected (`Credentials are required for a new connection`); an existing profile saved without credentials SHALL keep its existing ref.
- **FR-7** With `credentialSource:'secret-manager'`, `save` SHALL require `secretName`, store the ref as `aws:<name>`, and require `secretStore.has(ref)` (else `The supplied Secrets Manager secret was not found or cannot be read by this instance role`).
- **FR-8** The first profile of a provider SHALL become default; `isDefault:true` SHALL clear the flag on the provider's other profiles; `setDefault(id)` does the same and 404-style errors `Connection not found`.
- **FR-9** `publicProfile` SHALL strip `secretRef` and add `credentialConfigured`, `secretSource`, and `secretRefLabel` (the AWS secret name, only for `secret-manager`). No API response SHALL include credentials.
- **FR-10** `getDefault(provider)` SHALL consider only enabled profiles and prefer `isDefault`, else the first (sorted by name).
- **FR-11** `resolve(provider)` SHALL prefer the default managed profile (source `managed`); otherwise fall back to deployment env: Databricks service principal (`DATABRICKS_HOST` + `DATABRICKS_CLIENT_ID` + `DATABRICKS_CLIENT_SECRET`) before PAT (`DATABRICKS_HOST` + `DATABRICKS_TOKEN`); ServiceNow (`SERVICENOW_INSTANCE` or `OPS_SERVICENOW_INSTANCE`, `SERVICENOW_USERNAME`, `SERVICENOW_PASSWORD`); Snowflake key-pair/password (`SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PRIVATE_KEY` or `SNOWFLAKE_PASSWORD`) or legacy token (`SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_TOKEN`); Jira has no env fallback; otherwise `null`.
- **FR-12** `status(provider)` SHALL return `{configured, ready, verified, source, profileId, lastTest}`. `verified` is `lastTest.status === 'connected'` for managed, `null` for deployment, `false` when unconfigured or resolution throws; `reason` is a redacted message when unconfigured/failed.
- **FR-13** `test(id)` SHALL run a provider-specific check (Databricks list pipelines limit 1; ServiceNow incident status verify; Snowflake `SELECT 1`; Jira issue-search verify), persist `lastTest {status, message, testedAt}` on the profile, and return the public profile. Failures SHALL be stored with `errorText`-redacted messages, not thrown.
- **FR-14** `credentials(profile)` SHALL read the ref from the secret store, JSON-parse it (falling back to `{token: raw}`), and throw `Connection credentials are unavailable` when absent.
- **FR-15** Profiles SHALL persist in the file store (`<RUNTIME_DIR>/connection-profiles.json`) or Postgres table `ops_connection_profiles(id, provider, data JSONB, updated_at)` according to `OPS_METADATA_STORE` (Postgres when `DATABASE_URL` is set).

## Scenarios
### S1 First profile is default
- **Given** no Jira profile **When** saving `jira-1` then `jira-2` **Then** `jira-1` is default; saving `jira-2` with `isDefault:true` flips it.
### S2 Managed beats environment
- **Given** a Databricks profile and `DATABRICKS_TOKEN` in env **When** `resolve('databricks')` **Then** source is `managed`.
### S3 Service principal precedence
- **Given** no profile, env has host, client id/secret and a token **When** `resolve` **Then** credentials are the service principal.
### S4 Partial Databricks service principal
- **When** saving credentials with `clientId` but no `clientSecret` **Then** `A Databricks service principal needs both a client ID and a client secret`.
### S5 Test failure is recorded
- **Given** an unreachable host **When** `POST /api/connections/:id/test` **Then** 200 with `lastTest.status:'failed'` and redacted message.
### S6 Secret-manager reference
- **When** saving with `credentialSource:'secret-manager'` and a secret the role cannot read **Then** the error above and nothing is stored.

## Interfaces
- HTTP: `GET /api/connection-templates`, `GET /api/connection-provider-status`, `GET/POST /api/connections` (POST 201), `GET/PUT/DELETE /api/connections/:id`, `POST /api/connections/:id/test`, `POST /api/connections/:id/set-default` (`server.mjs:105-114`).
- Data: profile `{id, provider, name, config, credentialSource, secretRef, enabled, isDefault, createdAt, updatedAt, lastTest}`.
- Managed ids created by connectors: `<provider>-nervecenter`.

## Non-functional constraints
- Credentials only in the secret store; profiles in Postgres/file hold the ref only. Error messages are redacted via `errorText` (SPEC-connectors-05).
- Secrets Manager access is limited to names the operator types; the UI never lists secrets.

## Known gaps / deviations
- `delete(id)` removes the profile only; the stored credentials at `connections/<id>/credentials` stay in the secret store (orphaned secret). Connector removal calls this too.
- `POST /api/connections/:id/test` is not matched by the admin-only pattern, so any authenticated user can trigger an outbound credentialed request and overwrite `lastTest`.
- `DELETE` returns `200 {deleted:false}` for a missing id rather than 404; `setDefault` of a missing id throws a generic 400.
- `aws:` refs let an admin point a profile at any Secrets Manager secret the instance role can read; its content is JSON-parsed and used as credentials with no schema validation (`#validateCredentials` runs only for `direct`).
- Jira has no deployment-env fallback in `resolve`, although the connector injects `JIRA_*` for the agent.
- Snowflake profile test builds `SnowflakeService` from raw config + credentials; Snowflake `key_pair` credentials are only reachable through this API (the connector form sends password).
- `errorText` redaction (`/(authorization|password|token|secret)\s*[:=]?\s*\S+/`) also masks the word after "token" in ordinary messages, e.g. "token expired".
- No automated test exercises `ConnectionService` directly (only through fakes).

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/connections/connection-service.mjs:10-51` | none |
| FR-2, FR-3 | `connection-service.mjs:117-129` | none (endpoint helpers: `backend/tests/endpoint.test.mjs:23`) |
| FR-4, FR-5, FR-6 | `connection-service.mjs:130-144,199-214` | none |
| FR-7 | `connection-service.mjs:134-138` | none |
| FR-8 | `connection-service.mjs:147-158,198` | none |
| FR-9 | `connection-service.mjs:194-197` | none |
| FR-10 | `connection-service.mjs:59-62` | none |
| FR-11 | `connection-service.mjs:65-91` | none |
| FR-12 | `connection-service.mjs:93-111` | none |
| FR-13 | `connection-service.mjs:160-187` | none |
| FR-14 | `connection-service.mjs:189-193` | none |
| FR-15 | `backend/src/connections/connection-profile-store.mts` | none |

## Open questions
- Should deleting a profile also delete its `connections/<id>/credentials` secret?
