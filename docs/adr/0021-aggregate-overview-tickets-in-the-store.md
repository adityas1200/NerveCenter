# 0021. Aggregate Overview ticket numbers in the store

- Status: accepted
- Date: 2026-10-14
- Related: specs/overview/overview-page.md (SPEC-overview-01 FR-3, FR-4, FR-6, FR-8), specs/platform/manual-refresh.md (FR-2), specs/platform/pagination.md (SPEC-platform-11 FR-5, FR-6), ADR 0005

## Context
`GET /api/overview/tickets` and `GET /api/overview/work` return a few counts, a small chart and at most 8 rows, but both call `OperationsService.overview()`. That loads every ticket in scope through `store.listTickets()` (Postgres: full `data` of up to 5,000 rows, then their latest activity from `ops_ticket_events`), filters access with `canAccess()` in Node, and counts in memory. `overviewTickets()` then loops over every ticket once per chart bucket (up to 60).

Each Overview load therefore reads the whole ticket table and its activity, once for the Tickets card and once for Your work. Cost grows with ticket count, and past 5,000 tickets the counts are silently wrong because of the cap.

`ticketPageSql()` in `backend/src/app/ticket-page.mts` already applies the same access rule in SQL (the `visible` CTE) and counts in Postgres for the Tickets page, with a JavaScript twin (`pageTicketRows()`) for the file store.

## Decision
Compute Overview ticket numbers in the store from the existing access rule, without loading ticket rows into Node.

1. Move the `visible` CTE out of `ticketPageSql()` into a shared fragment in `ticket-page.mts`. The Tickets page SQL is otherwise unchanged.
2. Add `ticketOverviewSql()` beside it: one query over the shared fragment that returns every field `overviewTickets()` returns today (`ticketSummary`, `agentResolved` counts, `dqOpen`, and per-bucket `chart` counts, bucketed in SQL from the request's bucket edges). No ticket `data` or activity leaves the database.
3. Add a bounded attention query for Your work: open tickets only, the FR-6 rank (priority x 10 + 2, then newest), `LIMIT 8`, selecting only the fields an attention item shows. The pipeline half of FR-6 is unchanged here.
4. Add `ticketOverview()` and `attentionTickets()` to both stores (`operations-store.mts`): SQL for Postgres, a JavaScript twin next to `pageTicketRows()` for the file store.
5. `overviewTickets()` and `overviewWork()` in `overview-summary.mjs` call these instead of `service.overview()`. Response shapes do not change; the frontend is untouched. The legacy `GET /api/overview` keeps its current code path.

Definitions stay as they are today, including two existing inconsistencies, which are recorded as Known gaps in SPEC-overview-01 rather than changed here:
- Summary counts treat `closed, cancelled, resolved, archived` as closed (`CLOSED_STATUSES`); the chart and `dqOpen` also accept `canceled`.
- Your work's "assigned to or shared with me" uses `sameIdentity()` (id, email, email user part or name), not the id-only match used for access. The SQL must reproduce this matching.

No table, column or index changes. If measurement shows a missing index, it is a separate migration under ADR 0001.

## Alternatives considered
- Keep loading tickets and cache the result for a few seconds: still reads everything on each miss, adds staleness and cross-instance cache questions.
- Store precomputed counters updated on every ticket write: fastest reads, but every write path and sync must keep them right; much more to get wrong.
- Lower the 5,000 cap or page through all rows: still moves every ticket into Node to produce a handful of numbers.
- Write a new SQL access rule for Overview: a second copy of a security rule that could drift from the Tickets page.

## Consequences
- Overview ticket reads become a single aggregate query and an 8-row query; payload and Node work no longer grow with ticket count.
- Projects with more than 5,000 tickets get correct counts instead of capped ones. This is the only visible difference.
- The Tickets page and Overview share one access fragment, so a change to it affects both; both test suites must pass.
- Tests (new files, no existing test edited): old and new paths return identical results for a mixed fixture (open/closed, every priority, private and project visibility, owners, approvers, members, visitors, admin), on the file store and, with `NC_TEST_DATABASE_URL`, on Postgres; a user denied a private ticket gets counts without it; bucket edges and `canceled` are covered.
- Before/after timing with about 5,000 generated tickets is recorded in the PR.
- Rollback: revert the two `overview-summary.mjs` call sites to `service.overview()`; no data is migrated.
- Out of scope, with follow-up ADRs: the notification poll, the inbox badge, the running-task indicator, and Overview pipelines reading the ledger only.
