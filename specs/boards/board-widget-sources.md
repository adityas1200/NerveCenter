---
id: SPEC-boards-02
title: Board widget sources (NerveCenter, SQL, text)
status: implemented
area: boards
owners: []
code:
  - backend/src/boards/board-service.mjs
last_verified: 2026-10-11
---

# Board widget sources

## Purpose
Define exactly what data each widget can show, so a board shows the same numbers as the app pages and a SQL widget can read the warehouse safely.

## Scope
- In scope: the 14 NerveCenter sources, SQL widgets, text widgets, filter templating, time buckets, widget `viz` settings.
- Out of scope: board CRUD and permissions (SPEC-boards-01), drawing (SPEC-boards-03).

## Actors and permissions
Data runs as the reader. Ticket sources use `listTickets({user})`, so only accessible tickets count. SQL widgets run with the platform connection, whoever reads.

## Requirements
- **FR-1** Each result SHALL be `{ columns, rows[][], source, total?, links?, markdown?, at }`; rows are capped at 200.
- **FR-2** NerveCenter sources SHALL be: `pipelines.health` (Succeeded, Failed, Missed, Paused; running counts as succeeded), `pipelines.list`, `pipelines.runs_over_time` (Succeeded, Failed per bucket), `pipelines.slow` (last run over 1.5x usual duration), `tickets.open_by_priority`, `tickets.open_by_status` (Open, In progress, Waiting on you), `tickets.list` (open by default, `status=all` for every ticket in range; links to `/tickets/<id>`), `tickets.over_time` (Raised, Resolved), `tickets.fixed_with_agent` (by kind), `dq.checks_by_status` (latest result per check), `dq.failing_checks` (failed first, then warning), `tasks.agent_activity` (Finished, Changes per bucket), `pipelines.runs` (one row per run: Pipeline, Run, Status, Started, Ended; newest 200), `pipelines.failures_by_day` (Pipeline, then one Failed-runs column per bucket, only pipelines that failed in the range). An unknown id SHALL be rejected when the widget is saved.
- **FR-3** The `match` filter (or widget param) SHALL do a case-insensitive substring match on pipeline name/id, ticket title/number/id/tags, or check name/table/dataset; `all` or empty matches everything.
- **FR-4** Time-series sources SHALL bucket by hour when the range is two days or less, else by day, with at most 62 buckets.
- **FR-5** Ranges SHALL resolve as: `today` from local midnight, `12h|24h|7d|30d` from now, `custom` from `from`/`to` (default last 7 days), anything else 7d. Pipeline and DQ sources honour the range; ticket open-state sources ignore it.
- **FR-6** SQL widgets SHALL contain one statement that starts with `select`, contains no `;`, and none of insert, update, delete, merge, drop, alter, create, truncate, grant, call, exec as whole words; otherwise save fails with 400. Provider is databricks (default) or snowflake; optional catalog and schema, and named `params` (names matching `[a-z_][a-z0-9_]*`, values max 200 chars).
- **FR-7** SQL param values SHALL be templates filled from filters (`{{key}}`, `{{range}}`, `{{range.from}}`, `{{range.to}}`; unknown or `all` becomes empty) and sent as bound parameters (Databricks named params with TIMESTAMP type for names ending `_time`, `_at`, `from`, `to` when the value is ISO; Snowflake positional bindings), never concatenated into SQL.
- **FR-8** Databricks SQL SHALL need a warehouse id from the connectors setting, the data-quality config or the connection, else the widget shows "Set a Databricks SQL warehouse in Connectors..."; a missing connection gives "No <provider> connection is configured".
- **FR-9** Text widgets SHALL return the markdown (max 4000 chars) with no columns.
- **FR-10** `viz` SHALL be normalised per type: metric (`valueColumn`, `labelColumn`, `suffix`, `tone` neutral/good/bad/warning/auto, `sparkline`), chart (`chart` column/bar/line/area/donut/pie, `xColumn`, up to 6 `seriesColumns`, `layout` stacked or grouped, `showValues`), table (up to 12 `columns`, `statusColumn`, `limit` 1..200 default 50).
- **FR-11** Widget failures SHALL be turned into one plain sentence: missing table names the table, syntax error, rejected credentials ("Check Connectors"), otherwise the message truncated to 200 chars.
- **FR-12** Chart widgets SHALL also take `heatmap`, `funnel` and `gantt`. Heatmap: `xColumn` is the row label and `seriesColumns` (up to 62) the value columns, or with `pivotColumn` the rows are long (`xColumn`, `pivotColumn`, first series as the value) and are pivoted; `scale` high_is_bad, high_is_good or neutral (default). Funnel: `xColumn` is the stage and the first series the count, in row order. Gantt: `xColumn` is the lane, `startColumn` and `endColumn` ISO times, optional `stateColumn` and `labelColumn`; each defaults to the column named Started/Start, Ended/End, Status/State. Any chart MAY carry a `unit` (max 20). These fields are kept only on the chart kinds that use them.
- **FR-13** Metric widgets MAY carry `gauge { max > 0, target?, higherIsBetter? (default true) }`, drawn as a ring against the target with On, Near or Off target in words; a gauge without a positive max is dropped.
- **FR-14** The new `viz` fields SHALL be optional: boards saved before them read and draw unchanged, so no migration is needed.

## Scenarios
### S1 Same numbers as the pages
- **Given** tickets of mixed priority **Then** `tickets.open_by_priority` rows equal the Overview priority counts and respect `match`.
### S2 Bound SQL
- **Given** statement `... WHERE loaded_at >= :from_time` with param `{{range.from}}` **Then** Databricks receives a TIMESTAMP parameter `from_time`.
### S3 Failure isolation
- **Given** one SQL widget on a missing table **Then** its result is `{ error: "The table this widget reads does not exist: ..." }` and other widgets render.

## Interfaces
- Source catalogue `NERVECENTER_SOURCES` (id, title, columns, `honours`, `fits`, description), served by `GET /api/boards/sources`.
- Config: connectors setting `databricks.settings.warehouseId`, data-quality config `warehouseId|catalog|schema`, connection profiles `databricks`, `snowflake`.

## Non-functional constraints
- SQL runs on the shared platform credential; row cap 200; results cached 45 s (SPEC-boards-01).

## Known gaps / deviations
- `pipelines.health` calls `monitor` with `runLimit: 200` and `from/to` for every widget; a board of many pipeline widgets issues many scans (cache only helps identical filters).
- `tickets.list` with `status=all` filters by `updatedAt` in range while `tickets.over_time` uses created and closed dates; the range semantics differ per source.
- `tickets.fixed_with_agent` and `tasks.agent_activity` ignore `match` although the Sonic column names suggest per-brand views.
- `tasks.agent_activity` reads at most 1000 tasks.
- Hard-coded starter widget `veltrix_rows` and select options (veltrix, corvana, hcp, nbrx) are product-specific sample content in the shared service.
- DQ sources read `dataQualityService.monitor` with limit 100, so more than 100 recent results are silently ignored.
- Tests exercise sources, `match`, SQL binding and the plain error; they do not cover the time-bucket edges, `custom` range, Snowflake bindings or the 200-row cap.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2, FR-3 | `backend/src/boards/board-service.mjs:36-49`, `:329-377` | `backend/tests/boards.test.mjs:82` |
| FR-4 | `backend/src/boards/board-service.mjs:148-157` | `backend/tests/boards.test.mjs:82` (indirect) |
| FR-5 | `backend/src/boards/board-service.mjs:116-121` | `backend/tests/boards.test.mjs:69` |
| FR-6 | `backend/src/boards/board-service.mjs:77-83` | `backend/tests/boards.test.mjs:54`, `:187` |
| FR-7, FR-8 | `backend/src/boards/board-service.mjs:137-143`, `:307-327` | `backend/tests/boards.test.mjs:69`, `:116` |
| FR-9 | `backend/src/boards/board-service.mjs:76`, `:303` | `backend/tests/boards.test.mjs:187` |
| FR-10 | `backend/src/boards/board-service.mjs:90-97` | `backend/tests/boards.test.mjs:54` |
| FR-11 | `backend/src/boards/board-service.mjs:384-392` | `backend/tests/boards.test.mjs:116` |
| FR-2 (runs, failures_by_day), FR-12, FR-13, FR-14 | `backend/src/boards/board-service.mjs` (`normaliseWidget`, `#runNerveCenter`) | `backend/tests/boards-viz.test.mjs` |

## Open questions
- Should SQL widgets be validated with a SQL parser?
