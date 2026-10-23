---
id: SPEC-pipelines-06
title: Data platform catalog and provider contract
status: implemented
area: pipelines
owners: []
code:
  - backend/src/platform/data-platform-catalog.mjs
  - backend/src/platform/data-platform.mjs
  - backend/src/bootstrap.mjs
last_verified: 2026-10-03
---

# Data platform catalog and provider contract

## Purpose
Decide which data platform (Snowflake or Databricks) to read from connection state and expose one provider-neutral contract (pipelines, runs, tables, DDL, lineage) so callers never branch on provider.

## Scope
- In scope: `DataPlatformCatalog`, `DataPlatformService`, `DATA_PLATFORM_PROVIDERS`, capabilities.
- Out of scope: connection CRUD/verification (connections area), provider internals (SPEC-pipelines-04/05).

## Actors and permissions
Internal; consumed by `OperationsService` (`dataPlatform` in `bootstrap.mjs:44,53`).

## Requirements
- **FR-1** Supported providers SHALL be exactly `snowflake` and `databricks`; anything else SHALL throw "Unsupported data platform".
- **FR-2** `OPS_DATA_PLATFORM_PROVIDER` SHALL pin a provider; an invalid value SHALL make construction throw.
- **FR-3** `activeProvider()` SHALL return the pinned provider, else the first provider (snowflake, then databricks) whose connection status is `ready`, else null.
- **FR-4** `status()` SHALL list every provider with `ready, configured, verified, source, reason, capabilities` and the active/pinned provider; a failing status call SHALL yield `ready:false` with the error reason.
- **FR-5** `service(provider?)` SHALL resolve the connection and fail with "Configure a <provider> connection to browse the data platform" when none exists.
- **FR-6** Capabilities SHALL be: snowflake pipelines/runs/tables/ddl/lineage with kinds `task, pipe, dynamic_table`; databricks the same with kind `job`.
- **FR-7** Databricks pipelines SHALL be tagged `kind: 'job'` and listed with `sources:[{id:'databricks.jobs',status:'ok',count}]`.
- **FR-8** Databricks lineage without an object SHALL be the task graph of one run (`runs_after` edges); with an object it SHALL be Unity Catalog table lineage.

## Scenarios
### S1 Nothing configured
- **When** `service()` is called **Then** it rejects with the configure message; `OperationsService` instead reports "No pipeline platform is connected".
### S2 Both ready
- **Then** `activeProvider()` is `snowflake` (list order), while `/api/monitor` still reads both.

## Interfaces
- Env: `OPS_DATA_PLATFORM_PROVIDER`.
- Methods: `listPipelines, getPipeline, listRuns, getRun, listTables, getTable, getDdl, getLineage, collectRcaEvidence, retriggerPipeline, getRemediationResult`.
- No HTTP route exposes the catalog directly (`GET /api/connections` and Connectors cover readiness).

## Non-functional constraints
- No caching; each call re-resolves the connection.

## Known gaps / deviations
- No tests for the catalog or `DataPlatformService`.
- `OperationsService._readyPlatformProviders` uses `status()` readiness and ignores the pin, so the pin affects only `activeProvider()` callers, not the monitor.
- Table/DDL/lineage/RCA/retrigger contract is not wired to any HTTP route or agent tool in `backend/src` (verified by grep); Databricks lacks RCA/retrigger implementations.
- DESIGN.md says "Delete" pass reduced backend to 27 files; these dormant surfaces survive.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/platform/data-platform.mjs:20,43`; `data-platform-catalog.mjs:51` | none |
| FR-2 | `data-platform-catalog.mjs:12-18` | none |
| FR-3 | `data-platform-catalog.mjs:38-45` | none |
| FR-4 | `data-platform-catalog.mjs:21-36` | none |
| FR-5 | `data-platform-catalog.mjs:48-55` | none |
| FR-6 | `data-platform.mjs:22-25,53` | none |
| FR-7 | `data-platform.mjs:65-69` | none |
| FR-8 | `data-platform.mjs:117-128,167-180` | none |

## Open questions
- Should `OPS_DATA_PLATFORM_PROVIDER` restrict the monitor too?
