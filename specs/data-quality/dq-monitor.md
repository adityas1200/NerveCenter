---
id: SPEC-data-quality-02
title: Data quality monitor and Data Quality page
status: implemented     # FR-10/FR-15 refresh revision approved and implemented 2026-10-11 (ADR-0010)
area: data-quality
owners: []
code:
  - backend/src/data-quality/data-quality-service.mjs
  - backend/src/monitoring/monitoring-service.mjs
  - backend/src/monitoring/monitor-store.mjs
  - backend/src/api/server.mjs
  - frontend/src/features/data-quality/DataQualityPage.tsx
  - frontend/src/features/data-quality/resultColumns.ts
last_verified: 2026-10-11
---

# Data quality monitor and Data Quality page

## Purpose
Show check results (passed, warning, failed) from the client's DQ result tables, kept equal to them (ADR-0007), for a period, link failures to the ticket that tracks them, and hand a failing check to the agent.

## Scope
- In scope: `monitor()`, `reconcile()`, `/api/data-quality/monitor[/reconcile]`, the page, the `data_quality_results` agent tool's use of `reconcile`.
- Out of scope: configuring tables (SPEC-data-quality-01), ticket creation (agent/Tasks).

## Actors and permissions
Any authenticated role may read.

## Requirements
- **FR-1** With no enabled table `monitor()` SHALL return `configured:false`, `source.mode:'unconfigured'`, empty items and summary.
- **FR-2** For each enabled table whose provider is available the service SHALL run one read-only SELECT of the mapped columns aliased to canonical names (`check_id, check_name, status, executed_at, dataset, field_name, rule_expression, failed_rows, message, severity, recommended_fix`), `ORDER BY executedAt DESC LIMIT n`, with `n = clamp(limit, 1..100)` (default 100), identifiers quoted per provider and the lower bound passed as a bound parameter (`:from_time` Databricks, `TO_TIMESTAMP_LTZ(?)` Snowflake).
- **FR-3** Window: explicit `from`/`to` win; else `range` (`Today`, Last hour/6/12/24 hours/7/30 days; default `Last 24 hours`; unknown label = unbounded). `to` and unparseable `executedAt` SHALL be applied in memory after the query.
- **FR-4** When `ruleTable` is set, rule metadata (`checkId, checkName, dataset, field, rule, severity, recommendedFix`, max 1000 rows) SHALL be joined by `check_id`, result-table values taking precedence.
- **FR-5** Status SHALL normalise: `pass|passed|success|succeeded|healthy|true -> passed`; `fail|failed|failure|error|false|violation|violated -> failed`; `warn|warning -> warning`; `running|pending|queued` kept; else `status_not_reported`. Severity SHALL be one of `critical|high|medium|low|info`, else `high` for failed, `medium` for warning, `low` otherwise.
- **FR-6** Each item SHALL carry `table`, `tableId`, `platform`, `failedRows` (number, 0 default), `recommendedFix` (default guidance text); `summary` SHALL be `{total, passed, failed, warning, unreported}`. With several tables items SHALL be merged newest first.
- **FR-7** A table that cannot be read (provider unavailable or query error) SHALL appear in `sources[]` as `unavailable` with a reason and SHALL NOT hide other tables. When none is readable the response SHALL be `configured:false`, `source.mode:'unavailable'`.
- **FR-8** `reconcile()` SHALL return the monitor result plus, for each failed item, `routing{ticketId, sourceRef}` where `sourceRef = dq-table:` + sha256 prefix(40) of `{provider, catalog, schema, resultTable, checkId, executedAt, status, message if no executedAt}`; an existing ticket by `sourceRef` sets `ticket{ticketId,status,taskId}` and `ticketAction:'view'`, otherwise `'investigate'`. It SHALL NOT create tickets.
- **FR-9** The `sourceRef` SHALL not depend on table id or name (renaming keeps links) but SHALL depend on the table's physical location.
- **FR-10** The page SHALL show four tiles (Checks run, Passed, Warnings, Failed), a table with Dataset/Rule/Failed rows columns shown only if mapped or populated, a Table column and filter only when 2+ tables are enabled, and filters (`status, severity, table, q`) in the URL. While visible, it SHALL refresh results every 60 s through the single fetch-and-re-read path in FR-15; it SHALL NOT independently poll the result query on the same cadence.
- **FR-11** The page SHALL show "No result table yet" when nothing is enabled, a "Not connected" card when no provider is verified, an amber alert for `mode:'unavailable'` or any `unavailable` source, and "All checks passed" when the failed filter has no hits and none failed.
- **FR-13** Once the background fetch has stored results (ADR-0002), `monitor()` and `reconcile()` SHALL read them, filtered by `status`, `severity`, `table` and `q` and paged by `limit` (at most 500) and `offset`, returning `total` beside `items`; `summary` SHALL count the whole window. Each item SHALL carry its ledger `key`, and `reconcile()` SHALL add `taskId` and `alertId` from the automatic investigation that looked at it. The page SHALL send its filters and page to the server (SPEC-platform-11).
- **FR-14** (ADR-0007) Each data-quality fetch SHALL read every enabled table over the whole retention window and make that table's stored results equal to what was read: rows read are upserted, and stored rows in the window that were not read are deleted, in one transaction. A table that hits the 10,000-row cap SHALL be replaced only from its oldest returned `executedAt` onward. A table that could not be read SHALL be left unchanged; a read with 0 rows SHALL clear it.
- **FR-15** (ADR-0007, ADR-0010) While visible, the page SHALL request a data-quality refresh (`POST /api/monitor/refresh`, `sources: ['dataQuality']`) when it opens and 60 s after the prior scheduled refresh and read complete, ignore a 429, and then re-read once. It SHALL pause scheduled requests while hidden and refresh once on becoming visible again unless a refresh is already in flight. Manual Refresh now SHALL remain available. No second 60 s query timer SHALL run.
- **FR-16** (ADR-0007) Removing a stored result SHALL NOT re-arm alerting for it: a failure already alerted SHALL NOT alert again if the source writes it back, and an open alert SHALL stay open until a later passing run.
- **FR-12** "Investigate" on a failed check SHALL open the agent panel with context kind `dq_check`; it does not call a ticket endpoint.

## Scenarios
### S5 Source overwritten (FR-14)
- **Given** 937 stored results for a table and a source that now holds 123 rows in the window **When** the next fetch runs **Then** 123 are stored and the page's total for the window is 123.
### S6 Source unreadable (FR-14)
- **Given** stored results and a fetch where the table's query fails **Then** the stored results are unchanged and the table shows as `unavailable`.
### S1 Two tables merged
- **Given** one Databricks and one Snowflake table, plus a paused third **When** monitor **Then** items from both tagged by table, newest first, paused table never queried, summary counts across both.
### S2 One table unreadable
- **Then** `Read 1 of 2 result tables.` in `source.reason`, `configured:true`.
### S3 Failure ticketed
- **Given** a ticket with `sourceRef` equal to the failure's **Then** `ticketAction:'view'`.
### S4 Custom window
- **When** the page changes the period **Then** reconcile is called with `range`, `from`, `to`.

## Interfaces
- `GET /api/data-quality/monitor?range=Last 24 hours&limit=100&from&to`; `POST /api/data-quality/monitor/reconcile` body `{range, limit, from, to}`. Response `{configured, configuration, tables[summary], providers, range, from, to, items[], summary, source{mode,platform,label,reason}, sources[], fetchedAt, reconciliationErrors:{}}`.
- Agent tool `data_quality_results` calls `reconcile({range, limit:100})` (`backend/src/tasks/nervecenter-tools.mjs:195`).
- UI `/data-quality`; detail sheet shows Rule, observed message, recommended fix, ticket.

## Non-functional constraints
- SQL is read-only (Databricks regex guard, Snowflake keyword guard); values are bound, identifiers quoted.
- 30 s statement wait with bounded polling; tables read sequentially.

## Known gaps / deviations
- Before the first background fetch, the live read is still capped at 100 rows per table with no truncation indicator. After it, the cap is gone (FR-13).
- `to` is not pushed into SQL, so a past window may be filled by newer rows first and return fewer than expected.
- Items with unparseable `executedAt` are dropped whenever any bound is present.
- `reconciliationErrors` is always `{}`; `store.findTicketBySourceRef` errors are swallowed (`.catch(() => null)`) and show `investigate` instead.
- Rule join assumes the rule table uses the same column names as the mapping.
- `source.platform` and label use only the first enabled table's provider.
- DESIGN.md names `GET /api/data-quality`; the real route is `/api/data-quality/monitor`.
- No backend test for time-window filtering, rule-table join, status normalisation or Snowflake parameter binding; severity filter has no unit test.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/data-quality/data-quality-service.mjs:96,27` | `backend/tests/data-quality.test.mjs:137` |
| FR-2 | `data-quality-service.mjs:97,128-134` | `data-quality.test.mjs:85` |
| FR-3 | `data-quality-service.mjs:7-10,98,103` | none |
| FR-4 | `data-quality-service.mjs:135-139` | none |
| FR-5 | `data-quality-service.mjs:19-20` | none |
| FR-6 | `data-quality-service.mjs:23,103,109` | `data-quality.test.mjs:85` |
| FR-7 | `data-quality-service.mjs:101-102,106-111` | `data-quality.test.mjs:125` |
| FR-8 | `data-quality-service.mjs:117-127` | `data-quality.test.mjs:85` |
| FR-9 | `data-quality-service.mjs:142` | `data-quality.test.mjs:118` |
| FR-10 | `frontend/src/features/data-quality/DataQualityPage.tsx:102,116,154-159`; `resultColumns.ts:11-17` | `frontend/src/features/data-quality/DataQualityPage.test.tsx:30`; `DataQualityTables.test.tsx:40` |
| FR-11 | `DataQualityPage.tsx:147,190` | `DataQualityPage.test.tsx:30` |
| FR-12 | `DataQualityPage.tsx:57-60,66` | none |
| FR-14 | `backend/src/monitoring/monitoring-service.mjs` `#fetchDq`; `monitor-store.mjs` `replaceDqResults` | `backend/tests/dq-mirror-source.test.mjs` |
| FR-15 | `DataQualityPage.tsx` `refreshResults`; `monitoring-service.mjs` `refresh` | `frontend/src/features/data-quality/DataQualityPage.refresh.test.tsx`, `DataQualityPage.cadence.test.tsx`; `backend/tests/dq-mirror-source.test.mjs` |
| FR-16 | `backend/src/monitoring/detector.mjs` (occurrences unchanged) | `backend/tests/dq-mirror-source.test.mjs` |
| FR-13 | `data-quality-service.mjs` `#ledgerMonitor`, `reconcile`; `DataQualityPage.tsx` | `backend/tests/monitoring-service.test.mjs`, `frontend/src/features/data-quality/DataQualityPage.paging.test.tsx` |

## Open questions
- Should the limit cap be surfaced as a `truncated` flag as the pipeline monitor does?

## Manual refresh amendment (approved 2026-10-13)

Browser polling, focus/reconnect refetch and live task streaming are superseded by [Manual browser refresh](../platform/manual-refresh.md). Navigation, selection changes, explicit Refresh and affected user writes load data. Server jobs and APIs remain available.
