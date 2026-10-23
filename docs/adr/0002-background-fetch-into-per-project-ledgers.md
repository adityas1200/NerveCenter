# 0002. Background fetch into per-project ledgers

- Status: accepted (approved by Mitesh 2026-10-06)
- Date: 2026-10-06
- Related: specs/platform/fetch-cadence.md (SPEC-platform-10), specs/automations/auto-investigation.md (SPEC-automations-01), specs/pipelines/pipeline-monitor.md (SPEC-pipelines-01), specs/data-quality/dq-monitor.md (SPEC-data-quality-02), ADR 0001

## Context
- Pipelines and data-quality results were read live from Databricks, Snowflake and the client's SQL warehouse each time someone had a page open. Every viewer re-queried every 15 to 60 seconds.
- Reads were capped at 100 runs per provider and 100 rows per DQ table. With 25 monitored jobs that left about four runs per job, and older history was unreachable.
- Background jobs ran only while someone was using the app (the presence gate). A failure at 2 AM was not seen until morning.
- Nothing kept a stable record of a run or a check result. So nothing could link a run to the task that investigated it, count missed schedule slots over time, or remember that an occurrence was already handled.

## Decision
- **Per-project ledger.** A background fetch writes each project's runs and check results into a ledger. The Pipelines and Data Quality pages, run history and agent tools read the ledger.
- **Tables.** Migration `backend/migrations/007-monitoring-ledger.sql` adds five tables. It is forward-only and safe to run twice.
  - `ops_pipeline_runs`: one row per (project, platform, pipeline, run).
  - `ops_dq_results`: one row per (project, result key). The key is the existing per-execution `sourceRef`.
  - `ops_monitor_state`: per (project, key). Holds fetch cursors, the last inventory snapshot, the detector's slot summary, and when each trigger was switched on.
  - `ops_alerts`: one row per alert, data as JSON. A partial unique index on (project_id, alert_key) WHERE status = 'open' allows only one open alert per key.
  - `ops_alert_occurrences`: primary key (project_id, occurrence_key). Claiming an occurrence is an insert, so it happens once even across instances.
- **File store.** The file store keeps the same records under `runtime/monitoring/<projectId>/{runs,dq,state,alerts,occurrences}.json`. Migration `007-monitoring-ledger.mjs` creates the directory. It keeps the newest 20,000 runs and 20,000 results per project. It is meant for one developer's machine.
- **Code.** `backend/src/monitoring/monitor-store.mjs` (both stores), `monitoring-service.mjs` (fetch, detect, prune) and `detector.mjs` (pure).
- **Incremental fetch.**
  - The first fetch reads the retention window, `sync.retainDays`, default 60 days, which matches the Databricks Jobs API's own retention.
  - Each later fetch reads from the newest stored start time less a 2-hour overlap. It also reaches back to the oldest run still running. Late state changes are picked up this way.
  - A fetch reads at most 10,000 runs per call. Databricks pages through `next_page_token`.
- **Pruning.** Runs and results older than the retention are pruned every 6 hours. Occurrence claims older than 8 days are pruned too.
- **Shared DQ instance.** The DQ service is one shared instance with one result-table setup. Its results are stored and watched once, under PILOT (`ledgerProjectId`), not once per project.
- **Presence gate (D2).** A project with any automation on is fetched and watched whether or not anyone is using the app. Other projects keep the gate.
- **Fallback.** Until a project's first fetch finishes, the pages read live as before. The response carries `diagnostics.source: 'live' | 'ledger'`.

## Alternatives considered
- **Page the live APIs harder** (no ledger). This keeps every viewer's cost and the 60-day horizon. It gives no stable run rows for task links, no missed-slot history and no once-only occurrence record.
- **Databricks system tables** (`system.lakeflow.job_run_timeline`) as the source. They give a 365-day history, but they need a SQL warehouse and Unity Catalog grants that not every client has. Left as an optional later backfill.
- **In-memory cache.** It is lost on restart, and two instances would act on the same failure twice.

## Consequences
- **Easier:**
  - Run history is as long as the retention.
  - Pages are fast and paged on the server.
  - Each run has a stable row to link a task to.
  - The platform is queried once per cadence per project instead of once per viewer.
- **Harder:**
  - Pages are as fresh as the cadence (default 5 minutes for pipelines, 15 for DQ). "Updated …" and Refresh now make that visible.
  - A second store must be kept in step in both backends.
- **Migration:** 007 only adds tables and a directory. Nothing existing is rewritten.
- **Rollback:**
  - Set `OPS_MONITORING=0` to stop the background fetch and detection.
  - The pages would then keep showing the last stored snapshot. Delete the `pipelines:inventory` and `dq:snapshot` state (the `ops_monitor_state` rows, or `runtime/monitoring/`) so they read live again.
  - The tables can stay, or be dropped by hand.
