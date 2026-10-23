---
id: SPEC-pipelines-04
title: Databricks read-only client (auth, jobs, runs, SQL, Unity Catalog)
status: implemented
area: pipelines
owners: []
code:
  - backend/src/connectors/databricks/databricks-service.mjs
  - backend/src/platform/data-platform.mjs
last_verified: 2026-10-03
---

# Databricks read-only client (auth, jobs, runs, SQL, Unity Catalog)

## Purpose
Read Databricks jobs, job runs, SQL warehouse query results and Unity Catalog metadata for the Pipelines and Data Quality pages, authenticating either with a personal access token or a service principal.

## Scope
- In scope: `DatabricksAuth`, `DatabricksHttpClient`, `DatabricksOperationsService`, `databricksFromConnection`; Databricks branches of `DataPlatformService`.
- Out of scope: changing a workspace (repair, rerun). The comment at `databricks-service.mjs:3-5` says those belong to the agent's own MCP connection.

## Actors and permissions
Backend only; uses the credential of the resolved `databricks` connection (admin-configured).

## Requirements
- **FR-1** Auth mode SHALL be `service_principal` when both client id and secret are set (wins over a token), else `pat` when a token is set; otherwise construction SHALL throw. A client id without secret (or vice versa) SHALL produce a specific error. A missing host SHALL throw "requires a workspace URL".
- **FR-2** A service principal SHALL exchange `client_credentials` (scope `all-apis`, HTTP Basic) at `{host}/oidc/v1/token`, cache the token until `expires_in` minus 60 s (min 30 s; default 3600 s), and share one in-flight exchange among concurrent callers. A PAT SHALL be sent as-is and never mint a token.
- **FR-3** On 401/403 with a service principal the client SHALL drop the cached token and retry the request exactly once.
- **FR-4** Error text SHALL redact the client secret; a rejected exchange SHALL include HTTP status and the platform's `error_description`.
- **FR-5** `listPipelines` SHALL page `/api/2.2/jobs/list` (page 100, max 5000 jobs, 50 pages), fail if `has_more` is true without a page token, and return pipelines with status `no_runs` (health is joined later).
- **FR-6** `listRuns` SHALL page `/api/2.2/jobs/runs/list` with `expand_tasks=true` (page 25, max 100 runs, 80 pages), pass `start_time_from/to`, and return runs newest first.
- **FR-7** Run status SHALL be derived from `status.termination_details.code`, then `state.result_state`, `status.state`, `state.life_cycle_state`: failed-like states -> `failed`; `SUCCESS|SUCCEEDED` -> `healthy`; running-like -> `running`; skipped-like -> `skipped`; bare `TERMINATED` -> `completed`; else `status_not_reported`. When the run level is not conclusive the task states decide (any failed -> failed; any running -> running; all healthy/skipped/completed with at least one healthy -> healthy). `failureSummary` SHALL come from the failing task or the run message, default "Pipeline run failed".
- **FR-8** `getRun` SHALL include a `taskGraph` (`taskKey`, `runId`, `state`, `dependsOn`).
- **FR-9** `queryRows` SHALL require a warehouse id and permit exactly one statement starting with `SELECT` and containing no `;`; it SHALL poll the statement up to 12 times at 1 s intervals.
- **FR-10** Databricks table browsing SHALL use Unity Catalog (`/api/2.1/unity-catalog/tables`, three-part names only) and require catalog and schema; table lineage SHALL degrade to an empty graph with a reason on failure.
- **FR-11** Every HTTP call SHALL time out at 30 s.

## Scenarios
### S1 Token revoked early
- **Given** a cached OAuth token that the workspace now rejects (401)
- **When** any request is made
- **Then** one new token is minted and the request retried; a second 401 surfaces as an error.

### S2 Task-level failure
- **Given** a run whose `status.state` is `TERMINATED` but one task has `TIMEDOUT`
- **Then** run status `failed`, summary from that task.

### S3 Mutating SQL
- **When** `queryRows` receives `SELECT 1; DROP TABLE x`
- **Then** it throws "Only one read-only SELECT statement is allowed".

## Interfaces
- Databricks REST: `jobs/list`, `jobs/get`, `jobs/runs/list`, `jobs/runs/get` (2.2), `sql/statements` (2.0), `unity-catalog/tables` (2.1), `lineage-tracking/table-lineage` (2.0).
- Config: connection `config.host`, `config.catalog|schema|warehouse`, credentials `token|pat|accessToken` or `clientId`+`clientSecret`; env fallbacks `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`.
- Pipeline shape `{pipelineId, name, platform:'databricks', status, summary, owner, schedule{quartzCronExpression,timezoneId,pauseStatus}, lastRunId, lastRunAt, lastSuccessAt}`; run shape `{runId, pipelineId, name, status, rawState, rawLifecycleState, startTime, endTime, durationMs, failureSummary}`.

## Non-functional constraints
- Read-only by construction (only GETs plus the SQL statement POST, which is SELECT-only).
- Secret never echoed; hosts built from the configured URL only.

## Known gaps / deviations
- SQL guard is a regex (`^\s*SELECT`, no `;`); a `;` inside a string literal is rejected, and comments before SELECT are not stripped (Snowflake's guard is stricter).
- `getPipeline` does one `jobs/runs/list` per call; `collectRcaEvidence`, `retriggerPipeline` and `getRemediationResult` are called by `DataPlatformService` but are not defined on `DatabricksOperationsService`; calling them throws a TypeError.
- No tests for jobs/runs normalisation, pagination, SQL polling or Unity Catalog paths.
- `FAILED_STATES` includes `SUCCESS_WITH_FAILURES` and `CANCELED`; cancellations count as failures (so create-ticket is offered).
- DataPlatformService table/DDL/lineage methods have no HTTP route or caller outside `platform/` (only the Snowflake/Databricks classes themselves).

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/connectors/databricks/databricks-service.mjs:39-53` | `backend/tests/databricks-auth.test.mjs:114,121` |
| FR-2 | `databricks-service.mjs:56-80` | `databricks-auth.test.mjs:38,46,62,83` |
| FR-3 | `databricks-service.mjs:99` | `databricks-auth.test.mjs:71` |
| FR-4 | `databricks-service.mjs:37,72-74` | `databricks-auth.test.mjs:93,104` |
| FR-5 | `databricks-service.mjs:115-126` | none |
| FR-6 | `databricks-service.mjs:142-153` | none |
| FR-7 | `databricks-service.mjs:7-23,174-181` | none |
| FR-8 | `databricks-service.mjs:24-26,155-159` | none |
| FR-9 | `databricks-service.mjs:128-134,161-173` | none |
| FR-10 | `backend/src/platform/data-platform.mjs:133-180` | none |
| FR-11 | `databricks-service.mjs:97` | none |

## Open questions
- Remove or implement the missing Databricks RCA/retrigger methods?
