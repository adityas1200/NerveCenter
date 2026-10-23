---
id: SPEC-overview-01
title: Overview page and /api/overview
status: implemented
area: overview
owners: []
code:
  - backend/src/app/operations-service.mjs
  - backend/src/api/server.mjs
  - frontend/src/features/overview/OverviewPage.tsx
  - frontend/src/features/overview/overviewSeries.ts
  - frontend/src/features/overview/agentLines.ts
  - backend/src/app/overview-summary.mjs
  - backend/src/app/ticket-page.mts
  - backend/src/app/operations-store.mts
last_verified: 2026-10-03
---

# Overview page and /api/overview

## Purpose
The landing page. A person sees, for a chosen period, how tickets, pipelines and data quality are doing, what the agent did, and the work that needs them. Every number links to the list behind it.

## Scope
- In scope: `GET /api/overview?from&to`, the page's panels (Tickets, Pipelines, Data quality, agent strip, "Your work" table), the series helpers.
- Out of scope: notifications bell (SPEC-overview-02), the monitor and data-quality endpoints it also calls, boards.

## Actors and permissions
All roles. Ticket numbers are limited to tickets the caller can access (SPEC-tickets-01); single-user identity sees everything.

## Requirements
- **FR-1** `GET /api/overview` SHALL return 200 even when pipeline monitoring is unavailable: a monitor failure SHALL yield empty pipelines, `capabilities.pipelineMonitoring { available: false, reason }` and `diagnostics.error`.
- **FR-2** `capabilities` SHALL report `pipelineMonitoring`, `dqMonitoring` (available when the DQ config exists and `enabled !== false`), and `slaTracking` and `upcomingSchedules`, which are always `available: false`.
- **FR-3** `from` and `to` (ISO) SHALL define an optional reporting window that affects only `ticketSummary.raised/openFromWindow/closedInWindow/resolvedWithAgent` and `agentResolved.inWindow`; live state (open tickets, failing pipelines, attention) SHALL ignore it. `window` echoes the parsed bounds or null.
- **FR-4** `ticketSummary` SHALL contain `open`, `closed`, `raised` (created in window), `openFromWindow`, `closedInWindow` (closed by `closedAt`, else `updatedAt`), `byPriority {p1..p4, other}` over open tickets (critical, high, medium, low, other) and `resolvedWithAgent`.
- **FR-5** `summary` SHALL include `totalPipelines`, `failedPipelines` (status failed/error/delayed/degraded), `runningPipelines`, `healthyPipelines`, `overduePipelines`, `pausedPipelines`, `criticalTickets` (open critical+high), `pendingApprovals` and `openHumanTasks` (pending inbox items of kind approval and question, workspace-wide), `activeInvestigations` (open tickets with a task).
- **FR-6** `attentionItems` SHALL list open tickets (`ticket:<id>`, rank priority x 10 + 2) plus failing pipelines that no listed ticket represents (`pipeline:<id>`, rank 20, href `/monitor?pipeline=`), sorted by rank then newest, max 8. In a non-single-user deployment it SHALL contain only items whose ticket is assigned to or shared with the caller (`attentionScope: 'mine'`); when that is empty it SHALL fall back to the whole queue (`'team'`).
- **FR-7** `pipelineFailures` SHALL attach the latest open ticket per pipeline and an `investigationStatus` of unassigned (no ticket), investigating (ticket with task) or assigned.
- **FR-8** `criticalTickets` SHALL be open critical and high tickets, priority then recency, max 8; `agentResolved` SHALL list closed tickets with `resolvedWithAgent` and counts by kind (pipeline, data_quality).
- **FR-9** `pipelines` (all items) and `recentRuns` (first 20) SHALL be returned from a monitor call with limit 1000, 5 runs each and range "All time".
- **FR-10** The page SHALL show: time-range picker (default from `useTimeRange`), an agent strip (finished, working now, waiting on you from the inbox, latest task), a Tickets panel (Open, High priority open, Waiting on you, Resolved + raised/resolved chart), a Pipelines panel (Succeeded, Failed, Missed, Paused + runs chart; "Fix connection" row when unavailable), a Data quality panel (passed, warning, failed, open DQ tickets; "Set up" row when unavailable), and the paged "Your work" table with reason text and an "Assign to me" action for unowned tickets.
- **FR-11** Pipeline tiles SHALL be counted once per pipeline from its health verdict so they add up to the total; pipelines that never ran count as other.
- **FR-12** Agent lines under each panel SHALL be built client-side from the last 200 tasks: tasks of `type: ticket` belong to Tickets (and also Pipelines or Data quality when the ticket text says so); other tasks by page context (Pipelines, Data Quality, Tickets) or wording.

## Scenarios
### S1 No Databricks
- **Given** no pipeline platform **Then** 200, `capabilities.pipelineMonitoring.available === false`, and the Pipelines panel shows "Fix connection".
### S2 Window narrows counts only
- **Given** window = last 24 h **Then** `raised` counts tickets created then, but `open` still counts every open ticket.
### S3 My work falls back to team
- **Given** a developer with nothing assigned **Then** `attentionItems` is the shared queue and `attentionScope` is `team`.
### S4 Assign from the table
- **When** the user clicks "Assign to me" on an unowned row **Then** PATCH `/api/tickets/:id` runs, overview and tickets refetch, and "Assigned to you" toasts.

## Interfaces
- HTTP: `GET /api/overview?from=&to=` (`server.mjs:58`). The page also calls `GET /api/tickets?status=all`, `GET /api/monitor?...runLimit=100`, the data-quality monitor, and `GET /api/tasks?limit=200`.
- UI: route `/`, panels link to `/tickets?...`, `/monitor?status=...`, `/data-quality?status=...`, `/inbox`, `/tasks?...`. Ticket tiles pass the period as `range`.

## Non-functional constraints
- The legacy `GET /api/overview` performs one monitor scan plus an in-memory pass over all tickets; no caching. The grouped Tickets and Work endpoints do not load ticket rows into Node (see the ADR 0021 amendment).
- Fixed zero fields exist for compatibility (see gaps); the page does not render them.

## Known gaps / deviations
- Hard-coded placeholders: `workflowSummary`, `activeWorkflows`, `monitors`, `scheduleWindow` (null), `failedMonitors`, `activeWorkflows`, `scheduledPrevious12Hours`, `scheduledNext12Hours`, `investigations.rcaRunning/rcaComplete` are always 0/null.
- "Waiting on you" on this page is the workspace-wide count of pending approvals and questions, not per user and not the ticket `waiting_on_you` count shown on the Tickets page; the two disagree.
- The frontend recomputes ticket series from `/api/tickets?status=all` and run series from `/api/monitor`, while the backend also returns `ticketSummary`; two sources can drift.
- Attention item `status` is the raw status, not the app status; titles like "Ticket needs triage" are generic fallbacks.
- `GET /api/overview` ignores `range` labels; only `from`/`to` are honoured.
- Only the happy path and the missing-platform case have backend tests for the legacy endpoint (`api.test.mjs:45`); `investigationStatus` is untested server-side. Window maths, access scoping, ticket aggregates and attention selection are covered for the grouped endpoints by `overview-ticket-counts.test.mjs`.
- Two definitions of "closed" meet in the Tickets group. `ticketSummary` counts `closed, cancelled, resolved, archived`; the chart series and `dqOpen` also count `canceled` (one l). A `canceled` ticket is open in the summary and closed in the chart. ADR 0021 kept both so the numbers did not move.
- "Your work" decides what is yours with `sameIdentity` (id, email, email user part or name, case-insensitive), a looser rule than the id-only match that decides who may open a ticket. ADR 0021 reproduces it in the store as is.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `backend/src/app/operations-service.mjs:84-95`, `:127-135` | `backend/tests/api.test.mjs:45` |
| FR-3, FR-4 | `backend/src/app/operations-service.mjs:86-87`, `:113-116`, `:137` | none |
| FR-5 | `backend/src/app/operations-service.mjs:119-123`, `:132` | none |
| FR-6 | `backend/src/app/operations-service.mjs:104-111` | none |
| FR-7 | `backend/src/app/operations-service.mjs:99-103` | none |
| FR-8 | `backend/src/app/operations-service.mjs:117-125`, `:139-142` | none |
| FR-9 | `backend/src/app/operations-service.mjs:90-91`, `:143` | none |
| FR-3, FR-4, FR-8 (grouped Tickets endpoint) | `backend/src/app/overview-summary.mjs` `overviewTickets`, `backend/src/app/ticket-page.mts` `ticketOverviewSql`, `overviewTicketRows` | `backend/tests/overview-ticket-counts.test.mjs`, `backend/tests/overview-summary.test.mjs` |
| FR-6 (grouped Work endpoint) | `backend/src/app/overview-summary.mjs` `overviewWork`, `backend/src/app/operations-service.mts` `attentionWork`, `backend/src/app/ticket-page.mts` `attentionTicketsSql`, `attentionTicketRows` | `backend/tests/overview-ticket-counts.test.mjs`, `backend/tests/overview-summary.test.mjs` |
| FR-10 | `frontend/src/features/overview/OverviewPage.tsx:102-140` | `frontend/src/features/overview/OverviewPage.test.tsx:69`, `:125`, `:159`, `:175`, `:195`, `:212` |
| FR-11 | `frontend/src/features/overview/overviewSeries.ts:44-66` | `frontend/src/features/overview/overviewSeries.test.ts:80`, `:92` |
| FR-12 | `frontend/src/features/overview/agentLines.ts:12-60` | `frontend/src/features/overview/agentLines.test.ts:8`, `:16` |

## Open questions
- Should "Waiting on you" be per user?

## Manual refresh amendment (approved 2026-10-13)

SPEC-platform-manual-refresh supersedes client full-list aggregation and refresh behavior: five independent aggregate/work reads, manual snapshots and per-section loading/error feedback. Existing metric definitions and history windows remain.

## Store-side aggregation amendment (ADR 0021, 2026-10-14)

Behaviour is unchanged; where the numbers are computed is not. `GET /api/overview/tickets` and `GET /api/overview/work` no longer load every ticket and its activity into Node to count them.

- The Tickets group is counted in the store over the tickets the reader may open (the same access rule as the Tickets page, SPEC-projects-02 FR-20..FR-23): one aggregate query in Postgres, a twin over the file store. FR-3, FR-4 and FR-8 definitions, windows and the response shape are as before.
- Work selects its eight rows in the store: open tickets by rank (priority x 10 + 2) then newest update, filtered to the reader's own when they are not single-user. Only when the reader has none of their own, or is single-user, does it call the pipeline monitor and add failing pipelines that no visible open ticket covers. A reader with their own work never sees pipeline rows (FR-6), so the monitor is skipped for them; the result is identical to the full overview.
- Counts are no longer capped at the 5,000 most recent tickets that the Postgres list read used; a project with more tickets now gets correct numbers.
- Ties in rank and update time resolve by creation time, then ticket id, in Postgres; the file store keeps its creation order.
- The legacy `GET /api/overview` keeps its in-memory path and is the reference the grouped endpoints are tested against.
