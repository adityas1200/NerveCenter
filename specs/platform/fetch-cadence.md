---
id: SPEC-platform-10
title: Per-project fetch cadence and the background fetch
status: implemented
area: platform
owners: []
code:
  - backend/src/monitoring/automation-settings.mjs
  - backend/src/monitoring/monitoring-service.mjs
  - backend/src/sync/sync-settings.mjs
  - backend/src/sync/integration-sync.mjs
  - backend/src/tasks/ticket-tasks.mjs
  - backend/src/api/monitoring-routes.mjs
  - backend/src/main.mjs
  - frontend/src/features/settings/SettingsPage.tsx
  - frontend/src/features/monitor/MonitorPage.tsx
last_verified: 2026-10-11
---

# Per-project fetch cadence

## Purpose
Each project decides how often its pipelines, data-quality results and tickets are fetched. The fetch runs on the server into
the ledger (ADR-0002). Pages and Sonic then read fresh, complete history without each viewer querying the platforms. A project
with automations is watched around the clock.

## Scope
- **In scope:**
  - The `sync` section's per-source cadence and retention.
  - The background fetch and its gate.
  - Refresh now.
  - The status the pages and Settings show.
- **Out of scope:**
  - What the detector does with the data (SPEC-automations-01).
  - Ticket import itself (SPEC-tickets-03).

## Actors and permissions
- **Project owners** change `sync` (`project.settings`).
- **Any project member** may ask for a refresh.

## Requirements
- **FR-1** `operations.yaml` `sync` SHALL accept, per source (`pipelines`, `dataQuality`, `tickets`, `knowledge`, `github`), `{ every, unit }`.
  - `unit` is seconds, minutes or hours. The resulting interval must be from 30 seconds to 24 hours.
  - Defaults: pipelines every 5 minutes, data quality every 15. Tickets, knowledge, and GitHub fall back to the shared `intervalValue`/`intervalUnit` interval, then their source-specific server default.
  - `retainDays` (default 60, 1 to 365) SHALL bound the stored history.
- **FR-2** Ticket polling SHALL use the project's own ticket cadence, else the shared interval. Integration sync SHALL independently gate each active project's knowledge and GitHub jobs on its own source cadence and `sync.enabled` switch, without selecting a primary project.
- **FR-3** A `sync` section with a bad cadence or retention SHALL be refused with HTTP 400 and a sentence naming the field.
- **FR-4** Each project SHALL be fetched on its own cadence into its ledger:
  - The first fetch reads the retention window.
  - Later fetches read from the newest stored start time less a 2-hour overlap, reaching back to the oldest run still running.
  - A source is fetched only when it is due.
  - (ADR-0007) Data quality is the exception: every fetch reads the whole retention window and replaces each table's stored results (SPEC-data-quality-02 FR-14).
- **FR-5** With a stored snapshot, the Pipelines and Data Quality pages, run history and agent tools SHALL read the ledger. They SHALL have no run cap: `diagnostics.truncated` is false and `maxRuns` is null. Before the first fetch they SHALL read live, as before.
- **FR-6** `POST /api/monitor/refresh` (any member, optional `sources`) SHALL fetch and detect for the project at once. A second refresh within 30 seconds SHALL answer 429. The Pipelines page's refresh button SHALL call it, then re-read the page.
- **FR-7** The status SHALL give, per source, its interval, the last fetch, the next fetch and the last error. It SHALL appear in Settings > Automations. The Pipelines page SHALL say when it was last updated.
- **FR-8** A project with any automation on SHALL be fetched and watched whether or not anyone is using the app (decision D2). Other projects SHALL be fetched only while someone is. `sync.enabled: false` SHALL stop the background fetch; Refresh now still works.
- **FR-9** The one shared data-quality setup SHALL be fetched and watched once, under its ledger project (PILOT). Other projects show where it is fetched.
- **FR-10** History older than `retainDays` SHALL be pruned at most every 6 hours.
- **FR-11** When no pipeline platform is connected, the stored inventory SHALL be cleared, so the page says it is not connected rather than showing old data.
- **FR-12** Settings > Workspace SHALL edit the cadence of pipelines, data quality and tickets, and the retention, keeping any other `sync` keys it does not show.
- **FR-13** A pipeline that first appears in the inventory after the project's first fetch SHALL have its runs read back to the retention window, up to 10 pipelines per fetch; one that fails is retried on the next fetch. Pipelines of a platform that failed to answer a fetch stay recorded, so they are not all read again when it is back. Projects fetched before this was recorded are not backfilled.

## Scenarios
### S1 Faster pipelines
- **Given** `sync.pipelines: { every: 2, unit: minutes }`
- **Then** the status shows a 120-second interval, and the next fetch two minutes after the last.

### S2 Night watch
- **Given** `pipelineFailed: task` and nobody signed in
- **When** a run fails at 02:00
- **Then** it is fetched within the cadence and investigated.

### S3 Refresh twice
- **When** someone clicks refresh twice within 30 seconds
- **Then** the second click answers 429, and the page still re-reads.

## Interfaces
- **HTTP:**
  - `POST /api/monitor/refresh` with `{ sources? }`, returns `{ result, status }`.
  - `GET /api/automation` returns `status`.
- **Config:** `sync.{pipelines,dataQuality,tickets,knowledge,github}.{every,unit}` and `sync.retainDays`.
- **Process:**
  - `OPS_MONITORING=0` disables the background fetch.
  - `OPS_MONITOR_CHECK_SECONDS` (default 15) is the timer.

## Non-functional constraints
One fetch per cadence per project, single-flight per project. Each call reads at most 10,000 runs or rows.

## Known gaps / deviations
- Snowflake task history beyond 7 days and Databricks system tables are not backfilled.
- The knowledge cadence has no field in the UI.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-3 | `automation-settings.mjs` `fetchSeconds`, `retainDays`, `validateSync`; `workspace.mjs` | `backend/tests/automation-settings.test.mjs`, `automation-api.test.mjs` |
| FR-2 | `sync-settings.mjs`, `ticket-tasks.mjs`, `integration-sync.mjs` | `automation-settings.test.mjs`, `integration-sync-project-scheduling.test.mjs` |
| FR-4, FR-6 | `monitoring-service.mjs` `runProject`, `#fetchPipelines`, `refresh` | `backend/tests/monitoring-service.test.mjs`, `automation-api.test.mjs`, `frontend/src/features/monitor/MonitorPage.automation.test.tsx` |
| FR-5 | `operations-service.mjs` `#ledgerInventory`, `monitor`; `data-quality-service.mjs` `#ledgerMonitor` | `monitoring-service.test.mjs` |
| FR-7 | `monitoring-service.mjs` `status`; `AutomationsTab.tsx`; `MonitorPage.tsx` | `monitoring-service.test.mjs`, `AutomationsTab.test.tsx`, `MonitorPage.automation.test.tsx` |
| FR-8 | `monitoring-service.mjs` `runProject` | `monitoring-service.test.mjs` (D2) |
| FR-9 | `data-quality-service.mjs` `ledgerProjectId`; `monitoring-service.mjs` | `monitoring-service.test.mjs` (DQ) |
| FR-10, FR-11 | `monitoring-service.mjs` `#prune`, `#fetchPipelines` | `monitor-store.test.mjs` (prune) |
| FR-12 | `SettingsPage.tsx` `WorkspaceTab` | `frontend/src/features/settings/SettingsPage.test.tsx` |

## Manual refresh amendment (approved 2026-10-13)

Browser polling, focus/reconnect refetch and live task streaming are superseded by [Manual browser refresh](../platform/manual-refresh.md). Navigation, selection changes, explicit Refresh and affected user writes load data. Server jobs and APIs remain available.
