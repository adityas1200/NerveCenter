---
id: SPEC-connectors-04
title: Secret store and secret-handling guarantees
status: implemented
area: connectors
owners: []
code:
  - backend/src/secrets/secret-store.mts
  - backend/src/api/server.mjs
  - backend/src/config.mjs
  - backend/src/connectors/connector-service.mjs
  - backend/src/connections/connection-service.mjs
last_verified: 2026-10-03
---

# Secret store and secret-handling guarantees

## Purpose
Hold credentials for connectors and connection profiles outside operations.yaml and profile records, behind one small interface with three backends, and state precisely where secret values may and may not flow.

## Scope
- In scope: the `set/get/has/delete/status` interface, `memory`, `file`, `aws` backends, backend selection, `/api/secrets/:ref`, the guarantees callers uphold.
- Out of scope: how the agent consumes env vars (see SPEC-connectors-02 `envForTasks`).

## Actors and permissions
`POST/PUT/DELETE /api/secrets/:ref` are admin-only (`rbac.mjs:59`). `GET /api/secrets/:ref/status` is not admin-only (see gaps).

## Requirements
### Store behaviour
- **FR-1** Every backend SHALL implement `set(ref,value)`, `get(ref)`, `has(ref)`, `delete(ref)`, `status(ref) -> {ref, present}`. `status` SHALL NOT return the value.
- **FR-2** `set` SHALL reject a non-string/empty ref (`secret ref is required`) and a non-string or empty value (`secret value is required`) in the memory and file backends.
- **FR-3** `get` of an unknown ref SHALL return `undefined` (not throw) in every backend. `delete` SHALL return whether something was removed.
- **FR-4** `createSecretStore()` SHALL choose by `OPS_SECRET_STORE`: `aws` -> AWS Secrets Manager, `file` -> file, anything else (default) -> memory. `.env.defaults` sets `aws`.
- **FR-5** The memory store SHALL hold values in process memory only; values are lost on restart.
- **FR-6** The file store SHALL persist all values in one JSON file (`<RUNTIME_DIR>/secrets.json`, plaintext JSON) written atomically via a temp file and rename, with file mode `0600`.
- **FR-7** The AWS store SHALL map ref `r` to Secrets Manager name `<prefix>/<r>`, where prefix is the first set of `NC_SECRET_PREFIX`, `NERVECENTER_SECRET_PREFIX`, `AWS_SECRET_PREFIX`, `OPS_SECRET_PREFIX`, else `nervecenter` (leading/trailing `/` trimmed); a ref beginning `aws:` SHALL be used verbatim (name or ARN) without the prefix.
- **FR-8** AWS `set` SHALL `PutSecretValue` and create the secret on `ResourceNotFoundException`; AWS `delete` SHALL force-delete without recovery window and return false when not found; other AWS errors SHALL propagate except not-found on `get`.
### Guarantees on callers
- **FR-9** Connector secrets SHALL be stored only at `connectors/<connectorId>/<ENV_NAME>`; managed-profile credentials only at `connections/<profileId>/credentials` (JSON) or an `aws:` reference.
- **FR-10** Secret values SHALL NOT be written to operations.yaml, `.mcp.json`, connection-profile records, connector cards, or any API response; only env var names, `secretsSet`/`credentialConfigured` booleans and (for AWS refs) the secret name are exposed.
- **FR-11** Secret values reach a running process only via `ConnectorService.envForTasks()` (agent sessions and integration sync env providers) and via in-process reads for data-page clients.
- **FR-12** `/api/secrets/:ref` SHALL support `GET .../status` (200 `{ref, present}`), `POST|PUT` with body `{value}` (201 `{ref, present}`), `DELETE` (200 `{ref, deleted, present:false}`); responses never include the value.
- **FR-13** Error text derived from provider failures SHALL pass through `errorText`, which redacts `authorization|password|token|secret` followed by a value and truncates to 400 chars.
- **FR-14** The UI SHALL never display a stored secret back; password inputs use `autoComplete="new-password"` and a blank input means "keep stored".

## Scenarios
### S1 File store persists
- **Given** a `FileSecretStore` **When** a value is set, a second instance on the same file reads it, `status` is queried, deleted twice **Then** read returns the value, status `present:true`, first delete `true`, second `false`; empty value is rejected.
### S2 Secrets never reach YAML
- **When** any connector is saved with a secret **Then** `JSON.stringify(operations)` and the operations file do not contain the value.
### S3 Prefix resolution
- **Given** `NC_SECRET_PREFIX=/acme/` **When** `name('connectors/jira/JIRA_API_TOKEN')` **Then** `acme/connectors/jira/JIRA_API_TOKEN`; `name('aws:team/x')` -> `team/x`.
### S4 Status leaks no value
- **When** `GET /api/secrets/<ref>/status` **Then** body is `{ref, present}` only.

## Interfaces
- HTTP: `/api/secrets/:ref` (+ `/status`) (`server.mjs:130-135`); `GET /api/meta` exposes `storage.secrets` (the backend name, `server.mjs:35`).
- Config: `OPS_SECRET_STORE` (`memory|file|aws`), `NC_SECRET_PREFIX`, `NERVECENTER_SECRET_PREFIX`, `AWS_SECRET_PREFIX`, `OPS_SECRET_PREFIX`, `AWS_REGION`/`AWS_DEFAULT_REGION`.
- `resolveSecret(store, ref)` returns `undefined` for an empty ref.

## Non-functional constraints
- File store is local-development only (plaintext at rest); deployed instances use AWS Secrets Manager.
- AWS client is created lazily; IAM of the instance role bounds what can be read.

## Known gaps / deviations
- Default backend is `memory` when `OPS_SECRET_STORE` is unset, so a local run silently loses all connector secrets on restart (connections then appear configured in operations.yaml but resolve no env).
- AWS `set` and `has` do no empty-value/ref validation (only memory/file do); AWS `has` is `Boolean(await get())`, so an empty-string secret reads as absent.
- `GET /api/secrets/:ref/status` is not admin-only, so any authenticated user can probe presence of arbitrary refs. Admins can also set/delete arbitrary refs, including ones used by connectors (`connectors/...`), bypassing connector state.
- `/api/secrets/:ref` takes one path segment, so refs containing `/` must be URL-encoded; the route silently falls through to 404 if not.
- Credentials are in cleartext in `envForTasks()` output and therefore in the agent process environment; any tool the agent runs can read them.
- AWS `delete` is irreversible (`ForceDeleteWithoutRecovery`).
- Orphaned secrets: deleting a connection profile leaves `connections/<id>/credentials` (SPEC-connectors-03).
- Redaction regex in `errorText` is pattern-based and can miss secrets in other formats and over-redact normal words.
- Test coverage: only the file store round trip; memory/AWS stores and the HTTP routes are untested.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2, FR-3 | `backend/src/secrets/secret-store.mts` | `backend/tests/endpoint.test.mjs:35` (file store only) |
| FR-4 | `secret-store.mts`; `backend/src/config.mjs:153` | none |
| FR-5 | `secret-store.mts` | none |
| FR-6 | `secret-store.mts` | `backend/tests/endpoint.test.mjs:35` (persistence; mode not asserted) |
| FR-7, FR-8 | `secret-store.mts` | none |
| FR-9 | `backend/src/connectors/connector-service.mjs:12`; `connection-service.mjs:133` | `backend/tests/connector-uses.test.mjs:61` |
| FR-10 | `connector-service.mjs:98,239`; `connection-service.mjs:194-197` | `backend/tests/connectors.test.mjs:26,58,71`; `connector-uses.test.mjs:61` |
| FR-11 | `connector-service.mjs:211-221`; `backend/src/bootstrap.mjs:49,60` | `backend/tests/connectors.test.mjs:26` |
| FR-12 | `backend/src/api/server.mjs:130-135` | none |
| FR-13 | `backend/src/lib/errors.mjs:5-16` | none |
| FR-14 | `frontend/src/features/connectors/ConnectorDialogs.tsx` (password inputs, `placeholder` keep) | `frontend/src/features/connectors/ConnectorsPage.test.tsx:27` |

## Open questions
- Should the default store outside `NODE_ENV=development` refuse to start in `memory` mode?
