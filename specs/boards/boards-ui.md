---
id: SPEC-boards-03
title: Boards pages (list, board view, live build, widgets)
status: implemented
area: boards
owners: []
code:
  - frontend/src/features/boards/BoardsPage.tsx
  - frontend/src/features/boards/BoardPage.tsx
  - frontend/src/features/boards/BoardWidgets.tsx
  - frontend/src/features/boards/BoardRangePicker.tsx
  - frontend/src/api/boards.ts
last_verified: 2026-10-13
---

# Boards pages

## Purpose
A person finds published dashboards, opens one, changes the period and pick-lists, and sees every widget computed by the backend. Builders create and refine boards by asking Sonic and manage publishing, layout, rename and delete from the page.

## Scope
- In scope: `/boards` list, `/boards/:boardId` view, filters in the URL, live-build polling, edit-layout mode, widget drawing (metric, table, chart, text).
- Out of scope: data and permissions (SPEC-boards-01, SPEC-boards-02), the Sonic panel itself.

## Actors and permissions
- Viewers: list, open published boards, use filters, refresh. No menu, no "New board", no fix links.
- Builders (admin, developer): "New board", plus the menu on boards where the server returns `canEdit`. Admins also see every draft.

## Requirements
- **FR-1** The list page SHALL load `GET /api/boards`, split results into "Published" and drafts ("Your drafts" for a developer, all drafts for an admin), filter both sections by a text search on title and description, and show Boards, Live and Drafts counts.
- **FR-2** Each card SHALL link to `/boards/<id>`. Empty states: builders see "No boards yet - Describe the dashboard; Sonic drafts it for you to publish"; viewers see "Nothing published yet".
- **FR-3** "New board" (builders only) SHALL open the Sonic panel with a prompt to build a board (draft plus link); it does not create a record by itself.
- **FR-4** The board page SHALL load `GET /api/boards/:id` (no retry) and show a summary card (status, description, widget, filter and view counts, owner, last update) and one control per filter: the period picker (today, 12h, 24h, 7d, 30d, custom range) then one select or text input per other filter. All picks SHALL live in URL query params so a link shares the view; "Reset" removes them.
- **FR-5** Widget data SHALL come from `POST /api/boards/:id/data` with the picked filters; only the first fetch of a page visit counts a view (`view=0` afterwards); changing a filter refetches. Each widget shows a skeleton while loading and its own error sentence on failure; builders get a "fix with Sonic" link on a failed widget.
- **FR-6** Metric widgets SHALL show the value column (with optional suffix, tone and, when the data has a Period column and one numeric column, a sparkline with delta); chart widgets SHALL draw column, bar, line, area, donut or pie from `viz.xColumn` and `seriesColumns` with stacked or grouped layout and optional value labels; table widgets SHALL show up to `viz.limit` rows, status cells coloured by meaning and link cells from `result.links`; text widgets SHALL render markdown. Colours SHALL be assigned by name meaning, then a fixed palette order.
- **FR-7** The grid SHALL be 1 column on small, 2 on medium and 4 on extra-large screens, widget sizes sm, md, lg.
- **FR-8** For builders with `canEdit`, the menu SHALL offer Publish/Unpublish (Publish disabled with no widgets), Edit layout, Rename and Delete (with confirmation). Edit layout SHALL allow move left or right, cycle size (sm, md, lg), remove and "ask Sonic about this widget", each saving through `PUT /api/boards/:id` with the full widget list. Success toasts: "Board published" ("Everyone can open it now."), "Board unpublished", "Board renamed", "Board deleted" (then navigate to `/boards`).
- **FR-9** While a running task's page context points at the board (selection or open item id) or its title contains the board title, the page SHALL poll the board spec and data every 4 s, check running tasks every 5 s (otherwise 30 s), show a "Sonic is building this board" banner with an "Open task" link (for a question about one widget, SPEC-tasks-12, "Sonic is looking into <widget>"; amended 2026-10-13), animate new, changed and removed widgets, and show a finished banner for 6 s.
- **FR-10** A draft that belongs to someone else SHALL show an explanation (403 from the API) instead of the board; an empty board shows "Nothing added yet" to viewers and "Add one with Sonic" to builders.
- **FR-11** Chart widgets SHALL also draw the heatmap (five steps of one hue, zero empty, missing data dashed, a legend saying which way is worse), funnel (what each stage lost in count and percent, and the share that reached the end) and gantt (lanes on one UTC axis, overlapping runs stacked, a legend of run states) of SPEC-boards-02 FR-12, and a metric with `gauge` SHALL draw a ring with its target and On, Near or Off target in words; they SHALL look the same as Sonic's task-page visualisations (SPEC-tasks-10 FR-25). Every mark is named on hover and to assistive technology, and rows that do not fit the kind show a plain sentence instead of a broken chart.

## Scenarios
### S1 Share a filtered view
- **When** a reader picks period 24h and brand "veltrix" **Then** the URL carries `range=24h&match=veltrix`, data refetches, and opening that URL elsewhere shows the same.
### S2 Build with Sonic
- **Given** a builder asks Sonic for a board **Then** after the task creates the draft the board page shows the building banner and widgets rise in, then the finished banner.
### S3 Widget error
- **Given** a SQL widget with a missing table **Then** that card shows the sentence and, for builders, a link to hand it to Sonic; other cards render.
### S4 Viewer on a draft
- **Then** a viewer who opens another person's draft sees "belongs to someone else".

## Interfaces
- Routes: `/boards`, `/boards/:boardId`. API client `boardsApi` (`list, sources, create, get, update, remove, publish, unpublish, data, preview`), query keys `boardKeys`.
- UI states: loading skeletons, per-widget errors, empty states, build banner.

## Non-functional constraints
- Accessible landmarks (`aria-label` on sections, widget list, filters); charts have labels. Data refetch only on filter change, manual refresh or build polling (no timer otherwise).

## Known gaps / deviations
- There is no way for a person to add or edit a widget from the UI without Sonic: layout, rename, publish and delete are manual; content changes always go through the agent.
- Builder detection on the list page uses the frontend role while the board page uses the server `canEdit`; a developer sees "New board" but cannot edit others' boards.
- Build detection is a heuristic (page context or title substring), so a task whose title merely mentions the board's name triggers the banner and 4 s polling.
- The page does not refresh data on an interval after the build finishes; a stale tab keeps old numbers until refresh.
- Tests cover list, search, roles, widget drawing, filters, error handoff, build banner and viewer states; layout edit actions (move, resize, remove), rename, delete and publish are not covered.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `frontend/src/features/boards/BoardsPage.tsx:26-97` | `frontend/src/features/boards/BoardsPage.test.tsx:35`, `:57`, `:67`, `:73` |
| FR-3 | `frontend/src/features/boards/BoardsPage.tsx:46` | `frontend/src/features/boards/BoardsPage.test.tsx:81` |
| FR-4 | `frontend/src/features/boards/BoardPage.tsx:170-188`, `:262-290`, `frontend/src/features/boards/BoardRangePicker.tsx` | `frontend/src/features/boards/BoardPage.test.tsx:136` |
| FR-5 | `frontend/src/features/boards/BoardPage.tsx:141-146`, `frontend/src/features/boards/BoardWidgets.tsx:124-205` | `frontend/src/features/boards/BoardPage.test.tsx:98`, `:136`, `:153` |
| FR-6 | `frontend/src/features/boards/BoardWidgets.tsx:205-360` | `frontend/src/features/boards/BoardWidgets.test.tsx:12-80`, `frontend/src/features/boards/BoardPage.test.tsx:98` |
| FR-7 | `frontend/src/features/boards/BoardPage.tsx:306` | none |
| FR-8 | `frontend/src/features/boards/BoardPage.tsx:192-245` | `frontend/src/features/boards/BoardPage.test.tsx:170` (ask-Sonic only) |
| FR-9 | `frontend/src/features/boards/BoardPage.tsx:31-62`, `:284-295` | `frontend/src/features/boards/BoardPage.test.tsx:184`, `:202` |
| FR-10 | `frontend/src/features/boards/BoardPage.tsx:299-304` | `frontend/src/features/boards/BoardPage.test.tsx:209`, `:220` |
| FR-11 | `frontend/src/features/boards/BoardViz.tsx`, `frontend/src/features/tasks/cards/VizBlocks.tsx` | `frontend/src/features/boards/BoardViz.test.tsx` |

## Open questions
- Should builders get a direct widget editor without Sonic?
