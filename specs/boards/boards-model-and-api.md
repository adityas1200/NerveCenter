---
id: SPEC-boards-01
title: Boards: model, permissions and HTTP API
status: implemented
area: boards
owners: []
code:
  - backend/src/boards/board-service.mjs
  - backend/src/api/board-routes.mjs
  - backend/src/bootstrap.mjs
  - backend/src/tasks/nervecenter-tools.mjs
  - frontend/src/api/boards.ts
last_verified: 2026-10-13
---

# Boards: model, permissions and HTTP API

## Purpose
Boards are dashboards that developers and admins build (usually by asking Sonic) and publish for everyone. A board is a saved spec of filters and widgets; the backend computes every widget's data.

## Scope
- In scope: spec normalisation and limits, draft/published lifecycle, ownership and visibility, CRUD, `/data` and `/preview`, view counting, result cache.
- Out of scope: what each widget source returns (SPEC-boards-02), UI (SPEC-boards-03).

## Actors and permissions
- Builder = role admin or developer. Viewer = anyone else. Role is `user.role` or resolved from RBAC.
- Reads: everyone sees published boards; a draft is visible to its owner and to admins.
- Writes (create, update, publish, unpublish, delete): builders only, and only the owner or an admin for existing boards.
- Boards are not in `ADMIN_ROUTES`; the service enforces the rules.

## Requirements
- **FR-1** A board SHALL need a title (max 80 chars, else 400 "A board needs a title"), description (max 400), up to 6 filters and up to 16 widgets (else 400). Filters are `range` (key forced to `range`, default one of today, 12h, 24h, 7d, 30d, custom; fallback 7d), `select` (options max 30, default `all`, `allLabel`) or `text`. A range filter SHALL always exist (added first if missing) and filter keys SHALL be unique.
- **FR-2** Widgets SHALL have type metric, table, chart or text (unknown becomes table), size sm/md/lg (defaults by type), title max 80, optional note max 200, and an id that is made unique within the board. Source kinds are `nervecenter`, `sql` and `text` (SPEC-boards-02).
- **FR-3** `POST /api/boards` SHALL create a draft owned by the caller with id `B-<8 hex>`, `views: 0`, and answer 201; viewers get 403 "Viewers can open boards but not build them".
- **FR-4** `GET /api/boards` SHALL return `{ items }` summaries (id, title, description, status, owner, widget and filter counts, timestamps, `views`, `canEdit`): all published boards plus the caller's drafts (all drafts for admins), published first then newest.
- **FR-5** `GET /api/boards/:id` SHALL return the full board with `canEdit`; unknown id 404; someone else's draft 403 "This board is a draft that belongs to someone else".
- **FR-6** `PUT|PATCH /api/boards/:id` SHALL re-normalise the merged spec (omitted fields keep their value), bump `updatedAt`, drop cached results for that board; non-owner non-admin gets 403.
- **FR-7** `POST /api/boards/:id/publish` SHALL fail with 400 "Add at least one widget before publishing" for an empty board, else set status published and `publishedAt`; `/unpublish` SHALL return it to draft and clear `publishedAt`. Both need edit rights.
- **FR-8** `DELETE /api/boards/:id` SHALL need edit rights and return `{ id, deleted: true }`.
- **FR-9** `GET|POST /api/boards/:id/data` SHALL resolve filters (defaults overridden by the reader's picks; unknown keys dropped; select values must be in `options`; `range` presets from now, `custom` using `from`/`to`), run every widget in parallel, and return `{ boardId, filters, widgets { <widgetId>: result | { error } }, fixes }`, where `fixes` holds the latest tested fix per widget (SPEC-tasks-13 FR-18; added 2026-10-13). One widget failing SHALL NOT fail the response.
- **FR-10** Widget results SHALL be cached 45 s per `(boardId, widgetId, resolved filters, board.updatedAt)`. Unless `?view=0`, each `/data` call SHALL increment `views` and set `lastViewedAt` without failing the response.
- **FR-11** `POST /api/boards/preview {widget, filters?, board?}` SHALL normalise and run one unsaved widget and return `{ widget, filters, columns, rows, ... }`.
- **FR-12** `GET /api/boards/sources` SHALL return `{ sources, widgetTypes, sizes, ranges }`.
- **FR-13** Each board SHALL be stored as its own record with its project: `ops_boards (id, project_id, data)` in Postgres, `boards[<id>]` in the file store (ADR 0004). A change or a view SHALL touch only that board; a view SHALL be counted atomically and SHALL NOT be undone by an edit saved at the same time. Lists SHALL be bounded (at most 500, newest first). Startup SHALL NOT create any board: a new workspace starts with none, and a deleted board stays deleted across restarts and deploys. (Changed from the earlier starter board "Commercial data ops daily", which was re-created on every start while the store was empty. Boards already in a store are left alone; delete them by hand.)
- **FR-14** Sonic SHALL manage boards through tools `list_boards`, `get_board`, `list_board_sources`, `describe_board_data`, `preview_board_widget`, `create_board`, `update_board`, `publish_board`, `delete_board`, acting as the requesting person with the same permission checks. `describe_board_data` SHALL be builder-only, return up to 50 tables or one table's columns (max 100), and be cached 60 s.

## Scenarios
### S5 No starter board
- **Given** an empty boards store **When** the backend starts (twice) **Then** `GET /api/boards` returns no items and no board was written.
### S1 Draft to published
- **Given** developer alice creates a board **Then** bob (viewer) gets 403 on it; **When** alice publishes **Then** bob can read it but DELETE by bob returns 403.
### S2 Bad SQL
- **When** a widget's statement is `DROP TABLE t` **Then** create returns 400 "read-only SELECT".
### S3 Empty publish
- **Then** publishing a board with no widgets returns 400.
### S4 Filters
- **Given** a select filter with options and a reader picks an unknown value **Then** it resolves to `all`.

## Interfaces
- HTTP: `GET/POST /api/boards`, `GET /api/boards/sources`, `POST /api/boards/preview`, `GET/PUT/PATCH/DELETE /api/boards/:id`, `POST /api/boards/:id/publish|unpublish`, `GET|POST /api/boards/:id/data` (`board-routes.mjs:9-27`). Errors carry `statusCode` 400/403/404.
- Data: setting `boards` = map id -> `{ id, title, description, filters[], widgets[], status, owner{id,name}, createdAt, updatedAt, publishedAt, views, lastViewedAt }`.

## Non-functional constraints
- Max 16 widgets, 200 rows per widget, 4000-char SQL and markdown, 45 s result cache, 60 s catalog cache.
- Plain-language widget errors (`plainError`), max 200 chars.

## Known gaps / deviations
- `POST /api/boards/preview` has no builder check (only `describe_board_data`, create and update do), so a viewer can run an arbitrary read-only SELECT on the connected platform (only create/update enforce `isBuilder`).
- The result cache key has no user, but ticket widgets are computed per caller's accessible tickets; for 45 s one user's ticket counts can be served to another.
- SQL safety is a keyword and `;` check on the statement text, not a parser: it rejects harmless text such as the word "merge" in a literal and does not block every read-only-but-unwanted construct.
- There is no per-board version history and delete is permanent. Two people saving the same board at once: the last save wins.
- Tests cover normalisation, filters, roles, starter seeding, the Sonic tools and a basic API flow; not covered: `/preview` permissions, update/unpublish routes, `view=0`, cache reuse and invalidation, `describe_board_data` limits.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `backend/src/boards/board-service.mjs:61-112` | `backend/tests/boards.test.mjs:54` |
| FR-3, FR-4, FR-5 | `backend/src/boards/board-service.mjs:200-227` | `backend/tests/boards.test.mjs:135`, `:187` |
| FR-6, FR-7, FR-8 | `backend/src/boards/board-service.mjs:228-252` | `backend/tests/boards.test.mjs:135`, `:187` |
| FR-9 | `backend/src/boards/board-service.mjs:116-135`, `:281-294` | `backend/tests/boards.test.mjs:69`, `:187` |
| FR-10 | `backend/src/boards/board-service.mjs:253`, `:284-293`, `backend/src/api/board-routes.mjs:21-25` | none |
| FR-11 | `backend/src/boards/board-service.mjs:295-300`, `backend/src/api/board-routes.mjs:14` | `backend/tests/boards.test.mjs:166` |
| FR-12 | `backend/src/api/board-routes.mjs:13` | `backend/tests/boards.test.mjs:187` |
| FR-13 | `backend/src/bootstrap.mjs` (no seeding call; `ensureStarter` removed) | `backend/tests/boards.test.mjs` (S5, :156) |
| FR-14 | `backend/src/tasks/nervecenter-tools.mjs:97-115`, `backend/src/boards/board-service.mjs:177-198` | `backend/tests/boards.test.mjs:166` |

## Open questions
- Should preview require builder rights, and should the cache key include the user?
