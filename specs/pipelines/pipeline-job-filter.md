---
id: SPEC-pipelines-03
title: Pipeline job include/exclude filter
status: implemented
area: pipelines
owners: []
code:
  - backend/src/platform/pipeline-filter.mjs
  - backend/src/app/operations-service.mjs
  - frontend/src/features/settings/PipelinesTab.tsx
last_verified: 2026-10-08
---

# Pipeline job include/exclude filter

## Purpose
Let an administrator narrow which jobs the Pipelines page shows per platform, from `operations.yaml`, without hiding a whole provider by accident.

## Scope
- In scope: `jobFilterOf`, `keepsPipeline`, `filterPipelines`; application inside the monitor inventory.
- Out of scope: the Settings > Pipelines editor UI and operations.yaml validation.

## Actors and permissions
Config is written by admins (`/api/settings`, admin-only). Evaluation has no actor.

## Requirements
- **FR-1** A platform entry's filter SHALL come from `platforms[].monitoring.jobs.{include,exclude}` (arrays or comma-separated strings, trimmed, lower-cased). A string/array `jobs`, or empty lists, SHALL mean no filter.
- **FR-2** A term SHALL match a pipeline when the name contains it (case-insensitive) or the `pipelineId` equals it.
- **FR-3** Exclude SHALL win; an empty include list SHALL keep everything not excluded.
- **FR-4** A pipeline SHALL belong to every platform entry whose `name`, `connection` or `type` equals `pipeline.platform` (case-insensitive) and SHALL be kept if any owner keeps it.
- **FR-5** Pipelines owned by no platform entry SHALL be kept. When no entry has a filter the list SHALL be returned unchanged.
- **FR-6** `filterPipelines` SHALL accept the platforms array or the whole operations object.
- **FR-7** The monitor SHALL apply the filter after listing and before fetching runs, only if `operations.yaml` could be read.
- **FR-8** Saving a platform in Settings > Pipelines (add, edit, including its job filter, or remove) SHALL ask the server to fetch pipelines now (`POST /api/monitor/refresh` with `sources: ["pipelines"]`, SPEC-platform-10 FR-6) and then mark the cached pipeline and overview data stale, so the Pipelines page shows the new set without a manual refresh. If the server refuses because a refresh ran in the last 30 seconds, the save still succeeds and the toast says the Pipelines page updates at the next fetch. The page reads a stored snapshot that is filtered when it is fetched, so re-reading alone is not enough.

## Scenarios
### S1 Include
- **Given** include `[sales, nbrx]` **When** names `Sales_Daily`, `Finance` **Then** only `Sales_Daily`.
### S2 Exclude beats include
- **Given** include `[sales]`, exclude `[_dev]` **Then** `sales_dev` is dropped.
### S3 Two entries, one connection
- **Given** entries A (include `a`) and B (include `b`) on provider `databricks` **Then** names matching either are kept.
### S4 Legacy free text
- **Given** `jobs: "all nightly jobs"` **Then** nothing is filtered.
### S5 Save applies the filter (FR-8)
- **Given** the Pipelines page showed `Sales_Daily` and `Finance` **When** an admin saves include `sales` in Settings > Pipelines **Then** a pipelines refresh is requested and, on opening the Pipelines page, only `Sales_Daily` shows, with no click on refresh.

## Interfaces
- Config: `operations.yaml` `platforms[].{name,type,connection,monitoring.jobs}` read via `workspace.readOperations()`.
- Code: `filterPipelines(pipelines, platformsConfig)`.

## Non-functional constraints
- Matching is substring-based on every call; O(pipelines x terms).

## Known gaps / deviations
- Only `/api/monitor` and `/api/pipelines` honour it; `/api/pipelines/:id[/runs]` and agent tools (`get_pipeline_runs`) do not.
- If `readOperations` throws, the filter is silently disabled (`.catch(() => null)`, `operations-service.mjs:233`).
- Substring matching on short terms over-matches; no regex/glob.
- No integration test through `OperationsService`.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/platform/pipeline-filter.mjs:19-29` | `backend/tests/pipeline-filter.test.mjs:15,49` |
| FR-2 | `pipeline-filter.mjs:31-33` | `pipeline-filter.test.mjs:23,33` |
| FR-3 | `pipeline-filter.mjs:36-40` | `pipeline-filter.test.mjs:28` |
| FR-4 | `pipeline-filter.mjs:42-46,57-60` | `pipeline-filter.test.mjs:37,42` |
| FR-5 | `pipeline-filter.mjs:56,59` | `pipeline-filter.test.mjs:15,37` |
| FR-6 | `pipeline-filter.mjs:53-55` | `pipeline-filter.test.mjs:49` |
| FR-7 | `backend/src/app/operations-service.mjs:233,239` | none |
| FR-8 | `frontend/src/features/settings/PipelinesTab.tsx` | `frontend/src/features/settings/PipelinesTab.refresh.test.tsx` |

## Open questions
- Should filters be enforced for all read paths including the agent tools?
