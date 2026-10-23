# 0004. Per-project tables for boards and data quality settings

- Status: accepted
- Date: 2026-10-06
- Related: specs/boards/boards-model-and-api.md, specs/data-quality/quality-gates.md, specs/projects/projects.md, specs/platform/storage-migrations.md

## Context
- Boards and data quality configs belong to a project, but both live in `ops_application_settings (key text PRIMARY KEY, data jsonb)`, a table described as app-level settings. Nothing in its shape says it holds project data.
- Data quality: one row per project, the project folded into the key (`data_quality` for PILOT, `data_quality:<projectId>` for the rest; the file store uses `dataQuality[:<projectId>]`). See `dqKey` in `backend/src/app/operations-store.mjs`.
- Boards: one `boards` row holds every board of every project, with `projectId` inside each record (`backend/src/boards/board-service.mjs`). Every change reads the whole blob, edits one board and writes it all back, so two projects saving at once lose one write. `noteView` does this on every board open, so a busy board can undo another project's edit. Listed in the boards spec under Known gaps.
- No other code reads or writes `ops_application_settings`.

## Decision
1. Migration `backend/migrations/009-per-project-settings.sql`:
   - `ops_boards (id text PRIMARY KEY, project_id text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())` with an index on `(project_id, updated_at DESC)`.
   - `ops_data_quality_configs (project_id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`.
   - Copy each board in the `boards` row into `ops_boards` (`project_id` from the record, `pilot` when missing), and each `data_quality[:<id>]` row into `ops_data_quality_configs`. `ON CONFLICT DO NOTHING`, guarded with `to_regclass`, so it is safe to run twice and on a fresh database.
   - Then `DROP TABLE ops_application_settings`, and remove its `CREATE TABLE` from `ensureControlSchema` in `backend/src/storage/postgres.mjs` (it runs on every boot and would bring the table back empty).
   - Migration `003-projects.sql` updates `ops_application_settings` and relies on `ensureControlSchema` having created it. With that gone, a fresh database would fail at 003. So 003's `UPDATE` is wrapped in `IF to_regclass('ops_application_settings') IS NOT NULL`. Databases that already applied 003 never run it again, so this text change only affects fresh databases, where there is nothing to update. This is the one edit to an applied migration, made on purpose.
2. File-store twin `backend/migrations/009-per-project-settings.mjs`: in `application-state.json`, move `settings.boards` to a top-level `boards` map (by id, each with `projectId`) and `settings.dataQuality[:<id>]` to `dataQuality[<projectId>]`, then delete `settings`. Guarded, so a second run changes nothing.
3. Store interface (`operations-store.mjs`, both stores) replaces `getSetting` / `setSetting` with: `listBoards(scope, { limit })` (the same scope argument `listTickets` takes), `getBoard(id)`, `putBoard(board)`, `deleteBoard(id)`, `noteBoardView(id)` (one atomic `UPDATE ... SET data = jsonb_set(...)`), and `getDataQualityConfig(projectId)` / `setDataQualityConfig(config, projectId)` reading the new table. `listBoards` is bounded (default 200, capped 500, ordered by `updated_at DESC, id`).
4. `board-service.mjs` uses those calls: one row read or written per change, never the whole set. Scope checks (`filterByScope`, `assertRowInScope`, `writeProjectId`) and all board behaviour stay as they are; the project filter moves into the query (`project_id = ANY($1)`, or every project for the All view).
5. API, UI and board ids do not change.

## Alternatives considered
- Add a `project_id` column to `ops_application_settings`: rejected. It stays a key/value table, and boards would still be one blob per project, so edits within a project still race.
- Fix only the description: rejected. The owner wants the storage to be per project, and the race is real.
- One generic `ops_project_settings (project_id, key, data)`: rejected. Boards need a row each to stop the race, so a generic table does not remove the need for `ops_boards`.

## Consequences
- Each board change touches one row, so concurrent edits in different projects no longer overwrite each other; view counts are atomic.
- Both stores change shape: tests for the migration (copy, PILOT default, run twice, fresh database) and the store (bounded list, scope) are added. Existing board and data quality tests should pass unchanged; any that read `getSetting`/`setSetting` directly need `AI_TEST_CHANGE_ACK=ack`.
- Specs updated: boards model (storage section, Known gaps entry for the race closed), quality gates (storage), projects (the line saying boards live in one blob), storage-migrations (FR-4 table list).
- Rollback: forward-only. To go back, revert the code and add a migration that rebuilds `ops_application_settings` from the two tables. Take `pg_dump -t ops_application_settings` before deploying.
- Numbering: zs-sandbox has ADR 0002 and migration 007, the RBAC-audit branch ADR 0003 and migration 008, the ticket-events branch ADR 0005 and migration 010; this is ADR 0004 and migration 009. The test that lists file migrations needs every name present once these merge.
