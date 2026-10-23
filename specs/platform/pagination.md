---
id: SPEC-platform-11
title: Pagination for every long list
status: implemented
area: platform
owners: []
code:
  - frontend/src/components/ops/Pager.tsx
  - frontend/src/lib/usePager.ts
  - frontend/STYLE_GUIDE.md
  - backend/src/monitoring/monitor-store.mjs
  - backend/src/api/server.mjs
  - backend/src/api/monitoring-routes.mjs
  - backend/src/app/ticket-page.mts
  - backend/src/tasks/task-store.mts
  - frontend/src/features/tickets/TicketsPage.tsx
  - frontend/src/features/tasks/TasksPage.tsx
  - frontend/src/features/inbox/InboxPage.tsx
last_verified: 2026-10-11
---

# Pagination

## Purpose
A list that can grow past a screen is paged, with the reader choosing how many items to see. A long list never renders
everything at once, and nothing past an old cap is unreachable.

## Scope
- **In scope:**
  - Every list or grid of repeated items that can hold more than 10.
  - The page-size choice.
  - URL state.
  - The server paging contract for lists the server pages.
- **Out of scope:**
  - Short fixed lists (settings fields, menus, a top-5 widget).
  - Board widgets, which are bounded by their own limit.

## Requirements
- **FR-1** Every such list SHALL page with `Pager`. Sizes are 10, 25, 50 and 100 for tables and lists, and 12, 24 and 48 for card grids. The smallest size is the default.
- **FR-2** Page and size SHALL live in the URL (`page`, `size`, or `<prefix>Page` beside another list), so a link opens the same page. Changing a filter, search or sort SHALL return to page 1. The default size and page 1 SHALL be left out of the URL.
- **FR-3** A list the server pages SHALL ask for `limit` and `offset`, and the server SHALL answer with `items` and `total`. This applies to:
  - pipeline run history: `GET /api/pipelines/:id/runs`, returning `{ items, total, slots, fetchedAt }`;
  - data-quality results: `GET` or `POST /api/data-quality/monitor[/reconcile]` with `status`, `severity`, `table` and `q`, returning `{ items, total, summary }`, where `summary` counts the whole window;
  - alerts: `GET /api/alerts`.
- **FR-4** The bar SHALL be hidden while everything fits on the smallest size. It SHALL show "first–last of total <noun>", the page numbers and the size picker.
- **FR-5** Tickets, tasks and inbox SHALL apply their existing access scope, filters, search and ordering before `limit`/`offset`, and return `{ items, total }`. Every page SHALL be reachable beyond the previous fixed result caps. The server SHALL validate and cap `limit`, reject invalid offsets, and break sort ties by a stable unique ID. Lists remain live: a refresh may move rows between offset pages.
- **FR-6** Tickets SHALL return the full accessible-scope stat counts and filter options separately from the filtered page and its exact `total`. Tasks SHALL keep waiting, then running or queued, then historical items across the full result set. Inbox SHALL collapse notifications to the newest per task before counting and paging; its pending approval/question count SHALL cover the full accessible scope. Only the current page's items are sent to the browser.

## Known gaps / deviations
- Routine run history is at most 10 runs from the server.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2, FR-4 | `usePager.ts`, `Pager.tsx`, every list page | `frontend/src/lib/usePager.test.tsx`, `frontend/src/components/ops/Pager.test.tsx` |
| FR-3 | `monitor-store.mjs` `listRuns`, `listDqResults`, `listAlerts`; `operations-service.mjs` `pipelineRunHistory` | `backend/tests/monitor-store.test.mjs`, `monitoring-service.test.mjs`, `frontend/src/features/monitor/MonitorPage.automation.test.tsx`, `frontend/src/features/data-quality/DataQualityPage.paging.test.tsx` |
| FR-5, FR-6 | `backend/src/app/ticket-page.mts`, `backend/src/tasks/task-store.mts`, `backend/src/api/task-routes.mjs`, list pages | `backend/tests/ticket-page.test.mjs`, `backend/tests/task-inbox-pagination.test.mjs`, `backend/tests/pagination-postgres.test.mjs`, `frontend/src/features/tickets/TicketsPage.pagination.test.tsx`, `frontend/src/features/tasks/TaskInboxPagination.test.tsx` |

## Manual refresh amendment (approved 2026-10-13)

Browser polling, focus/reconnect refetch and live task streaming are superseded by [Manual browser refresh](../platform/manual-refresh.md). Navigation, selection changes, explicit Refresh and affected user writes load data. Server jobs and APIs remain available.
