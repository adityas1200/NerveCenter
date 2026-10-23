---
id: SPEC-pipelines-01
title: Pipeline monitor (Pipelines page and /api/monitor)
status: implemented
area: pipelines
owners: []
code:
  - backend/src/app/operations-service.mjs
  - backend/src/api/server.mjs
  - frontend/src/features/monitor/MonitorPage.tsx
  - frontend/src/features/monitor/pipelineWords.ts
last_verified: 2026-10-06
---

# Pipeline monitor (Pipelines page and /api/monitor)

## Purpose
Give a business user one screen that says which data pipelines (Databricks jobs, Snowflake tasks/pipes/dynamic tables) succeeded, failed, missed a scheduled run or are paused in a chosen period, with the latest runs, next run and the ticket that tracks a failure. Serves operators and viewers; investigation is handed to the agent (Sonic), not done here.

## Scope
- In scope: `GET/POST /api/monitor`, `GET /api/pipelines`, `GET /api/pipelines/:id`, `GET /api/pipelines/:id/runs`; run decoration with tickets; Pipelines page (`/monitor`).
- Out of scope: health verdict rules (SPEC-pipelines-02), job include/exclude (SPEC-pipelines-03), provider clients (SPEC-pipelines-04/05/06), ticket creation (tickets area).

## Actors and permissions
All authenticated roles can read (no route in `ADMIN_ROUTES` matches these paths). "Create ticket" calls `POST /api/tickets`, governed by the tickets spec.

## Requirements
- **FR-1** The system SHALL read pipelines and runs only from providers whose connection is `ready`; with no ready provider `monitor()` SHALL fail with "No pipeline platform is connected" (HTTP 400).
- **FR-2** The system SHALL query every ready provider independently and in parallel; a provider that errors SHALL be reported in `diagnostics.providers[].error` and SHALL NOT fail the response unless every provider fails.
- **FR-3** The system SHALL apply the `operations.yaml` job filter (SPEC-pipelines-03) to each provider's inventory before fetching runs.
- **FR-4** (Amended 2026-10-06 by ADR-0002: once a project has been fetched, the page reads the stored runs in the window with no cap, and the limits below apply only to the live read before the first fetch and to the background fetch, which reads up to 10,000 runs per call.) For Databricks with 1-25 monitored pipelines the system SHALL fetch each pipeline's runs separately (limit `ceil(100/n)`, min 1); otherwise it SHALL use one workspace-wide run feed. Snowflake always uses one feed with limit 10000; Databricks feed limit is 100.
- **FR-5** The time window SHALL be `from`/`to` when either parses, else the `range` label (`Today`, `Last hour|6|12|24 hours`, `Last 7|30 days`, short forms, default `All time` = unbounded). The window SHALL scope runs only; the inventory is never narrowed by it.
- **FR-6** Runs lacking `startTime` SHALL be kept; runs whose pipeline is not in the (filtered) inventory SHALL be dropped and counted in `diagnostics.ignoredRuns`.
- **FR-7** Each row SHALL carry the SPEC-pipelines-02 verdict computed from ALL window runs, `recentRuns` limited to `runLimit` (default 10) newest first, `status` = latest run status or `no_runs`, `lastRunId/At`, and `lastSuccessAt` = end time of the newest healthy run among `recentRuns`.
- **FR-8** Each failed run SHALL get `ticketAction` `view` (a ticket exists for `platform:pipelineId:runId`) or `create`. A row SHALL additionally expose `ticket`/`ticketAction`: a ticket matches when raised for the exact latest run, or when open and its title/description/failureSummary/tags mention the job name (len >= 6, also with `_`/`-` as spaces) or `job <id>`, or its `pipelineId` equals the id; `create` is offered only when the latest run failed and nothing matches.
- **FR-9** `diagnostics.truncated` SHALL be true when any provider returned at least its max run count. Reading the ledger it SHALL be false, with `maxRuns` null and `diagnostics.source: ledger` (SPEC-platform-10 FR-5).
- **FR-10** Reading SHALL NOT create tickets; `POST /api/monitor/reconcile` SHALL be an alias of the GET (same arguments in the body).
- **FR-11** The page SHALL show four tiles (Succeeded, Failed, Missed, Paused) computed client-side; Missed SHALL also count a pipeline with a missed slot in the detector's lookback (SPEC-automations-01 FR-41); Succeeded SHALL include `running`; legacy filter values `Healthy`/`Overdue` SHALL map to `Succeeded`/`Missed`.
- **FR-12** The page SHALL hide `no_runs` pipelines until "Show idle", order rows problems first (failed, overdue, running, unknown, healthy, no_runs, paused), and refetch every 60 s while visible.
- **FR-13** When the request fails, or no pipelines and `workspaceTotal` is 0, the page SHALL show one "Not connected" sentence with a link to `/connectors`; per-provider errors with other data SHALL show as a notice naming the provider.
- **FR-15** `GET /api/pipelines/:id/runs?limit&offset&provider` SHALL return one page of the pipeline's stored run history, newest first, with `total` and `fetchedAt`; each run SHALL carry `taskId` (the automatic investigation's, else its ticket's task) and `alertId`. The detail sheet SHALL page it (SPEC-platform-11) and show a Task column.
- **FR-16** The same response SHALL list the pipeline's missed, overdue and late slots from the detector's last pass (`slots[]`, each with its task), shown in the sheet as "Missed and late starts". Each row SHALL carry `missedCount`, `lateCount`, its open `alert` and what its automations do (`automation`).
- **FR-14** Duration SHALL be flagged "slower than usual" when `durationMs > 1.5 x typicalDurationMs`.

## Scenarios
### S1 No platform connected
- **Given** neither Databricks nor Snowflake is ready
- **When** `GET /api/monitor`
- **Then** 400 `No pipeline platform is connected...`; the page renders the Not connected card.

### S2 One provider down
- **Given** Snowflake ready, Databricks ready but returns 403
- **When** monitor is read
- **Then** 200, Snowflake rows present, `diagnostics.providers` has `{provider:'databricks', error}`.

### S3 Quiet pipeline in window
- **Given** a scheduled job with no run in "Last 24 hours" and its last slot is inside the window
- **Then** health `overdue` with `dueAt`; if the job has no schedule it is `no_runs` and hidden by default.

### S4 Failure already ticketed in ServiceNow
- **Given** an open ticket whose title contains the job name
- **Then** the row has `ticket` set and `ticketAction:'view'`; no duplicate Create offered.

### S5 Truncation
- **Given** a provider returns 100 runs (Databricks)
- **Then** `diagnostics.truncated` is true and the page shows a banner to narrow the period.

## Interfaces
- `GET /api/monitor?limit=1000&runLimit=10&range=All time&from&to` and `POST /api/monitor/reconcile` (body: same keys). Response `{items, total, workspaceTotal, recentRuns, range, from, to, fetchedAt, diagnostics{jobsFetched, runsFetched, ignoredRuns, failedRuns, unreportedRuns, unreportedStates, truncated, maxRuns, pageSize, providers[], sources[], pipelineAccessScope}}`.
- `GET /api/pipelines?limit&provider` -> `{items}` (inventory, 1 run each, no health). `GET /api/pipelines/:id?provider`, `GET /api/pipelines/:id/runs?limit=20&provider` -> `{items}` with ticket decoration.
- Provider inferred by `_providerFor`: explicit `provider`, else id prefix `task:|pipe:|dynamic_table:` -> snowflake, else databricks if ready, else first ready.
- Data: tickets via `store.listTickets()`; filter via `operations.yaml` `platforms[].monitoring.jobs`.
- UI `/monitor` URL params: `q`, `status`, `platform`, `showIdle=1`, `pipeline`, `run`, `provider`, `range`. Row opens a detail sheet; run marks (last 10, oldest to newest); "Ask Sonic" prompt depends on state; "Create ticket" posts `POST /api/tickets {pipelineId, runId, platform, priority:'medium'}` then investigate.

## Non-functional constraints
- Per-request provider timeouts 30 s; Databricks pagination bounded (50 job pages, 80 run pages).
- Read-only against platforms; no audit event on read.
- Errors without `statusCode` return HTTP 400.

## Known gaps / deviations
- Page sends `limit: 1000` in the body but caches under key `limit: 100` (`MonitorPage.tsx:143-144`); harmless but inconsistent.
- `GET /api/pipelines/:id` and `/runs` do not apply the job filter, so excluded jobs remain reachable by id.
- `OperationsService.FAILED` (line 11) differs from health `FAILED` (missing `failure`, `upstream_failed`); relies on provider normalisation to `failed`.
- Run feed is capped at 100 (Databricks) per refresh; long windows silently truncate (flagged only by the banner).
- No backend test exercises `monitor()` with data; only the not-connected 400 (`api.test.mjs:48`). Frontend tests mock the API.
- `docs/DESIGN.md:315` lists only `GET /api/pipelines`, `/api/pipelines/:id/runs` and `GET /api/data-quality`; the real surface adds `/api/monitor`, `/api/monitor/reconcile` and `/api/data-quality/*` (see SPEC-data-quality-02).

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/app/operations-service.mjs:228-231` | `backend/tests/api.test.mjs:48` |
| FR-2 | `operations-service.mjs:234-253` | none |
| FR-3 | `operations-service.mjs:233-239` | none |
| FR-4 | `operations-service.mjs:226,236-248` | none |
| FR-5 | `operations-service.mjs:12-17,274` | none |
| FR-6 | `operations-service.mjs:280-281` | none |
| FR-7 | `operations-service.mjs:283-294` | none |
| FR-8 | `operations-service.mjs:307-321,329-333` | none |
| FR-9 | `operations-service.mjs:298` | none |
| FR-10 | `operations-service.mjs:325`; `backend/src/api/server.mjs:60-61` | none |
| FR-11 | `frontend/src/features/monitor/MonitorPage.tsx:46,75,238-243` | `frontend/src/features/monitor/MonitorPage.test.tsx:57,98` |
| FR-12 | `MonitorPage.tsx:54,147,165-166` | `MonitorPage.test.tsx:57` |
| FR-13 | `MonitorPage.tsx:320-330` | `MonitorPage.test.tsx:108,117,124` |
| FR-15, FR-16 | `operations-service.mjs` `pipelineRunHistory`, `monitor`; `MonitorPage.tsx` `PipelineDetail` | `backend/tests/monitoring-service.test.mjs`, `frontend/src/features/monitor/MonitorPage.automation.test.tsx` |
| FR-14 | `frontend/src/features/monitor/pipelineWords.ts:28-29` | `MonitorPage.test.tsx:177` |

## Open questions
- Should job filters also bound `/api/pipelines/:id`?

## Manual refresh amendment (approved 2026-10-13)

Browser polling, focus/reconnect refetch and live task streaming are superseded by [Manual browser refresh](../platform/manual-refresh.md). Navigation, selection changes, explicit Refresh and affected user writes load data. Server jobs and APIs remain available.
