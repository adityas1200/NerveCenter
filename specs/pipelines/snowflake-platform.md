---
id: SPEC-pipelines-05
title: Snowflake read-only service and metadata provider
status: implemented
area: pipelines
owners: []
code:
  - backend/src/connectors/snowflake/snowflake-service.mjs
  - backend/src/connectors/snowflake/snowflake-metadata.mjs
  - backend/src/platform/snowflake-env.mjs
last_verified: 2026-10-03
---

# Snowflake read-only service and metadata provider

## Purpose
Treat Snowflake tasks, pipes and dynamic tables as pipelines, task history as runs, and INFORMATION_SCHEMA / ACCOUNT_USAGE as table, DDL and lineage sources, degrading to a stated reason when a view is not granted.

## Scope
- In scope: `SnowflakeService` (query transport/auth), `SnowflakeMetadataService`, env mapping helpers.
- Out of scope: connection storage (connections area); Snowflake MCP.

## Actors and permissions
Backend with the configured Snowflake role; visibility is limited to that role (`accessScope: 'current_role'`).

## Requirements
- **FR-1** Auth type SHALL be `password`, `key_pair` or `legacy_token` (inferred token > private key > password when unset); missing fields SHALL throw. `legacy_token` token types: `PROGRAMMATIC_ACCESS_TOKEN|OAUTH|KEYPAIR_JWT|WORKLOAD_IDENTITY_FEDERATION`. Account SHALL resolve to an HTTPS `*.snowflakecomputing.com` host only.
- **FR-2** `queryRows` SHALL accept only one statement starting with `SELECT` or `WITH` (comments stripped), no `;`, and none of INSERT/UPDATE/DELETE/MERGE/CREATE/ALTER/DROP/TRUNCATE/CALL/COPY/PUT/REMOVE/GRANT/REVOKE as words. Password/key-pair use the SDK driver; token auth uses SQL API `/api/v2/statements` with up to 12 polls at 1 s.
- **FR-3** Result column names SHALL be lower-cased.
- **FR-4** `listPipelines` SHALL return tasks (`SHOW TASKS IN DATABASE`), pipes and dynamic tables of the connection database with ids `task:|pipe:|dynamic_table:DB.SCHEMA.NAME`; each source SHALL report `{id,status,count,reason?}`; a failing source SHALL be `unavailable` with a plain reason, not an exception. A database is required.
- **FR-5** Task `listRuns` SHALL read `INFORMATION_SCHEMA.TASK_HISTORY` (<= 7 days back, limit up to 10000) and map `SUCCEEDED->healthy`, `FAILED|FAILED_AND_AUTO_SUSPENDED|CANCELLED->failed`, `SKIPPED->skipped`, `EXECUTING|SCHEDULED->running`, else `status_not_reported`; attempts > 1 append `:attempt` to the run id. Non-task pipeline ids SHALL return no runs.
- **FR-6** When health is requested, task rows SHALL get status/last run/last success from one history read; failure to read history SHALL NOT fail the inventory.
- **FR-7** `getTable`/`listTables` SHALL read INFORMATION_SCHEMA (identifiers validated with `/^[A-Za-z_][A-Za-z0-9_$]*$/` and upper-cased; strings escaped), `getDdl` SHALL use `GET_DDL`.
- **FR-8** `getLineage` SHALL try `SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES`, fall back to `VIEW_TABLE_USAGE`, merge task predecessor edges (`runs_after`), and walk to depth <= 5; with no source it SHALL return a reason.
- **FR-9** Task `retriggerPipeline` SHALL run `EXECUTE TASK` only for tasks in the configured database, with in-memory idempotency by key.
- **FR-10** `snowflakeConnectionFromEnv` / `snowflakeEnvFromConnection` SHALL round-trip account, warehouse, database, schema, role and one auth type (key pair > password > token), un-escaping `\n` in private keys.

## Scenarios
### S1 ACCOUNT_USAGE not granted
- **When** lineage is requested **Then** it falls back to `VIEW_TABLE_USAGE` and `reason` explains the missing privilege.
### S2 No warehouse
- **Then** a source is `unavailable` with "No warehouse is selected. Set a warehouse...".
### S3 Task out of scope
- **Given** `task:OTHER_DB.S.T` **Then** run/lineage/retrigger throws "outside configured database".

## Interfaces
- Config keys: `account, warehouse, database, schema, role`; credentials `authType, username, password, privateKey, privateKeyPassphrase, token, tokenType`; env `SNOWFLAKE_ACCOUNT|USER|PASSWORD|PRIVATE_KEY|PRIVATE_KEY_PASSPHRASE|TOKEN|TOKEN_TYPE|WAREHOUSE|DATABASE|SCHEMA|ROLE`.
- Outputs follow the shapes in `data-platform.mjs:12-18`.

## Non-functional constraints
- Read-only guard shared by every metadata call; 30 s timeout; token-authenticated requests refuse cross-origin redirects.

## Known gaps / deviations
- No tests at all for `snowflake-service`, `snowflake-metadata` or `snowflake-env`.
- `snowflake-env` helpers have no caller in `backend/src` (only exported).
- `EXECUTE TASK` bypasses the SELECT guard via a separate method; `retriggerPipeline`, `collectRcaEvidence`, `getRemediationResult` and table/DDL/lineage are reachable only through `DataPlatformService`, which no route or tool calls; they are dormant.
- Retrigger idempotency is per process memory.
- Pipes/dynamic tables never have run status; they stay `no_runs` and cannot be failed/overdue.
- `listPipelines` slices the merged list to `limit` after concatenating, so tasks can crowd out pipes.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/connectors/snowflake/snowflake-service.mjs:7-23` | none |
| FR-2 | `snowflake-service.mjs:25-29,37-43` | none |
| FR-3 | `snowflake-service.mjs:42,68` | none |
| FR-4 | `backend/src/connectors/snowflake/snowflake-metadata.mjs:102-179` | none |
| FR-5 | `snowflake-metadata.mjs:41,213-259` | none |
| FR-6 | `snowflake-metadata.mjs:182-200` | none |
| FR-7 | `snowflake-metadata.mjs:319-403` | none |
| FR-8 | `snowflake-metadata.mjs:410-481` | none |
| FR-9 | `snowflake-metadata.mjs:292-306` | none |
| FR-10 | `backend/src/platform/snowflake-env.mjs:12-46` | none |

## Open questions
- Should the dormant metadata surface get routes, or be removed?
