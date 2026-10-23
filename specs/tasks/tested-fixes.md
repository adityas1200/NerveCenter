---
id: SPEC-tasks-13
title: Tested fixes (sandbox, preview, approve, apply, verify)
status: implemented  # approved and implemented 2026-10-13 (ADR 0020)
area: tasks
owners: []
code:
  - backend/src/tasks/fix-service.mts
  - backend/src/tasks/sql-scope.mts
  - backend/src/tasks/nervecenter-tools.mts
  - backend/src/tasks/nervecenter-tool-categories.mjs
  - backend/src/tasks/task-runtime.mts
  - backend/src/boards/board-service.mts
  - frontend/src/features/tasks/cards/FixCards.tsx
  - frontend/src/features/tasks/cards/fixes.ts
  - frontend/src/features/tasks/cards/ExplainedApproval.tsx
  - frontend/src/features/tasks/taskEvents.ts
  - frontend/src/features/tasks/TaskThread.tsx
  - frontend/src/features/inbox/InboxPage.tsx
  - frontend/src/features/boards/BoardWidgets.tsx
  - plugin/operations-fleet/skills/remediation/references/clone-first-validation.md
last_verified: 2026-10-13
---

# Tested fixes: sandbox, preview, approve, apply, verify

## Purpose
When Sonic fixes data, the remediation skill already says: clone the table, change only the clone, test it, show the evidence, ask, apply to the original, verify. Two things are missing. Sonic has no safe place to do that work, so every clone and test statement asks for a production approval. And whatever it tested reaches the person only if Sonic chooses to draw it: the approval card shows a command, not the effect, and nothing checks the result after it is applied. This spec makes the tested fix a record NerveCenter computes and keeps: the person sees what will change (the table diff and their own board widgets "Now" and "After fix") before approving, NerveCenter applies exactly the tested statement, refuses if the table changed since the test, and then verifies and shows expected against actual. Data tools do the first half (SQLMesh plan and table_diff, Recce, Datafold), ops agents the second (Datadog "Verify Resolution", PagerDuty). None renders the reader's own dashboard after the fix; this does.

## Scope
- In scope: SQL table fixes on Databricks and Snowflake through NerveCenter's connections; a sandbox schema set in `operations.yaml`; five agent tools; the proposal, approval and result cards; widget markers on boards; prompt and skill guidance.
- Out of scope: code fixes (they keep `show_change` and the pull request, SPEC-tasks-10), re-running a pipeline or a data quality job after a fix (Sonic does that with its existing tools and their approvals), outside BI dashboards, rollback automation, more than one apply statement per proposal.

## Actors and permissions
- Sonic acts for the person who started the task with their project role (SPEC-projects-03 FR-22); system work acts as developer.
- `create_fix_sandbox`, `run_in_sandbox` and `drop_fix_sandbox` are category `default_write` (they write only inside the sandbox schema, FR-3), which the default policy runs without asking; a workspace policy can still make them ask or deny. `propose_fix` is `read`. `apply_fix` is `production_changes`, which asks by default (SPEC-tasks-03). A read-only task can only propose.
- Only an admin can approve an access change; production changes follow SPEC-tasks-05 as today.

## Requirements
### Sandbox
- **FR-1** `operations.yaml` SHALL accept `fixes.sandbox: {databricks?: "<catalog>.<schema>", snowflake?: "<database>.<schema>"}`. Without an entry for a provider, the sandbox tools SHALL fail with "No fix sandbox is set for <provider>. Add fixes.sandbox.<provider> to operations.yaml." and nothing SHALL be written.
- **FR-2** `create_fix_sandbox({provider?, table, reason})` SHALL copy `table` into the sandbox schema as `<table name>_fix_<6 characters>` (Databricks `SHALLOW CLONE`, Snowflake zero-copy `CLONE`) and return the sandbox name, the source name and the source snapshot (FR-9). The source SHALL be a fully named table (catalog.schema.table on Databricks, database.schema.table on Snowflake) and SHALL NOT be in the sandbox schema.
- **FR-3** `run_in_sandbox({provider?, statement, purpose, reason})` SHALL run one statement only when it is a SELECT, or a write whose target is a table in the sandbox schema: INSERT INTO or OVERWRITE, UPDATE, DELETE FROM, MERGE INTO, CREATE [OR REPLACE] TABLE or VIEW, ALTER TABLE, DROP TABLE, TRUNCATE TABLE. Any other statement, a second statement, a GRANT or REVOKE, a multi-table insert or a write outside the sandbox SHALL be refused with a sentence naming the reason. A SELECT SHALL return up to 50 rows; a write SHALL return what the platform reports.
- **FR-4** `drop_fix_sandbox({provider?, sandbox, reason})` SHALL drop one table in the sandbox schema and nothing else.

### Proposal and preview
- **FR-5** `propose_fix` SHALL take `{provider?, title, summary, target, sandbox, apply: {statement}, tests: [{name, result: passed|failed|skipped, command?, detail?}] (1-12), checks?: [{label, statement (SELECT on target), expect: {op: eq|ne|gt|gte|lt|lte, value}}] (0-8), key?: [column] (0-4), files?: same as show_change}`. `sandbox` SHALL be in the sandbox schema and `target` SHALL NOT. `apply.statement` SHALL be one INSERT, UPDATE, DELETE, MERGE, CREATE OR REPLACE TABLE or VIEW, or ALTER TABLE statement that writes `target`; anything else SHALL be refused.
- **FR-6** `propose_fix` SHALL compute, with read-only statements only: the row count of target and sandbox; how many rows are only in the target and only in the sandbox (`EXCEPT`); up to 6 sample rows each way (at most 10 columns, values cut at 80 characters); the columns that differ between samples paired by `key` when a key is given; and each check run against the sandbox (the target name swapped for the sandbox name) as the expected value.
- **FR-7** `propose_fix` SHALL find the SQL board widgets in the task's project that read `target` (by full name, or schema.table) on boards the person can open, at most 3, and run each twice with the board's default filters: as it is ("Now") and with `target` swapped for `sandbox` ("After fix"), keeping up to 12 rows and 8 columns of each. Swapping SHALL replace only table references, never text inside strings or comments.
- **FR-8** `propose_fix` SHALL return a proposal `{proposalId: "FP-<8>", state: "proposed", provider, title, summary, target, sandbox, snapshot, diff, checks, previews, tests, apply, files?}` as its tool result. The thread SHALL draw it as a proposal card: tests passed of total, the table change (rows before and after, rows that differ, changed columns, sample rows before and after), the predicted checks, one "Now | After fix" pair per previewed widget drawn with the board's own widget rendering, and the exact statement behind "Show statement". A failed test SHALL be shown in red at the top.

### Approval and apply
- **FR-9** A snapshot SHALL be `{version, lastAlteredAt, rowCount, takenAt}`: the Delta version from `DESCRIBE HISTORY <t> LIMIT 1` on Databricks, `lastAlteredAt` from the platform's table metadata on Snowflake, and `COUNT(*)` on both. A field the platform cannot give SHALL be null.
- **FR-10** `apply_fix({proposalId, reason})` SHALL read the proposal from the task's own events (the `propose_fix` result NerveCenter wrote), never from the agent's input. An unknown id SHALL fail with "No fix proposal <id> in this task"; an id already applied SHALL fail with 409 "Fix <id> was already applied".
- **FR-11** The approval for `apply_fix` SHALL be titled "Apply tested fix to <target>" and SHALL carry the proposal summary (`fix: {proposalId, title, target, sandbox, testsPassed, testsTotal, statement}`) on the Inbox item and the `approval.requested` event. The approval card in the thread SHALL show the proposal's tests, table change and widget previews above Approve and Deny.
- **FR-12** Before running, `apply_fix` SHALL take a new snapshot of the target. If any field known in both snapshots differs, it SHALL not run and SHALL fail with "<target> changed since the fix was tested (<what changed>). Clone it again, test again and propose the fix again."
- **FR-13** `apply_fix` SHALL run exactly the proposal's statement once through the project's connection.

### Verify and show
- **FR-14** After the statement succeeds, `apply_fix` SHALL verify: run each check on the target and compare with its expectation and with the sandbox value; take the row count; re-run each previewed widget and compare its rows with the "After fix" rows. The verdict SHALL be `passed` when every check passes and every preview matches, `failed` when any check fails or any preview differs, and `inconclusive` when there was nothing to compare.
- **FR-15** When the verdict is `passed`, `apply_fix` SHALL drop the sandbox table; otherwise it SHALL keep it for investigation and say so.
- **FR-16** `apply_fix` SHALL return `{proposalId, applied: true, appliedAt, target, verification: {status, checks: [{label, expected, actual, result}], rowCount: {before, after}, previews: [{boardId, widgetId, title, matches, expected, actual}]}, sandboxDropped}`, and the thread SHALL draw it as a result card: the verdict, "Expected | Actual" for each check and widget, and the row count before and after.
- **FR-17** A verified or failed fix SHALL be recorded on the task as `fixes: [{proposalId, title, target, status, appliedAt, widgets: [{boardId, widgetId}]}]` (at most 20 per task). A task without the field SHALL read as having no fixes.
- **FR-18** `POST /api/boards/:id/data` SHALL return `fixes: {<widgetId>: {taskId, proposalId, title, status, appliedAt}}` for this board's widgets from the 200 most recent tasks in the project, newest per widget, within 14 days. The board page SHALL show the fix under the widget header ("Fixed by Sonic · verified · T-1042", linking the task), with a warning tone when the check failed.

### Guidance
- **FR-19** When NerveCenter's tools are available, Sonic's prompt SHALL say that a data fix goes create_fix_sandbox, run_in_sandbox for the change and the tests, propose_fix, explain_action, then apply_fix, and that a fix is never applied with raw SQL through Bash when the sandbox is set. The plugin's clone-first validation reference SHALL say the same, recorded in `plugin/SOURCE.md`.

## Scenarios
### S1 Tested fix with board preview
- **Given** `fixes.sandbox.databricks` is set and a published board reads `commercial.gold.veltrix_sales_daily`
- **When** Sonic clones the table, fixes the clone with `run_in_sandbox`, and calls `propose_fix`
- **Then** the proposal holds the row counts, the differing rows, and that widget "Now" and "After fix"

### S2 Approve and verify
- **When** the person approves `apply_fix`
- **Then** the statement runs once on the target, the checks and the widget are re-run, the verdict is passed, the sandbox is dropped and the board shows "Fixed by Sonic · verified"

### S3 Table changed since the test
- **Given** the target's Delta version moved after the proposal
- **When** `apply_fix` runs
- **Then** nothing runs on the target and the tool fails with "changed since the fix was tested"

### S4 Write outside the sandbox
- **When** Sonic calls `run_in_sandbox` with `UPDATE commercial.gold.veltrix_sales_daily SET …`
- **Then** it is refused and nothing runs

### S5 No sandbox configured
- **When** Sonic calls `create_fix_sandbox` and `fixes.sandbox` has no entry for the provider
- **Then** it fails with the FR-1 sentence

## Interfaces
- Agent tools (nervecenter MCP): `create_fix_sandbox`, `run_in_sandbox`, `drop_fix_sandbox`, `propose_fix`, `apply_fix`, with the inputs above. Results are JSON text; the proposal and the result stay under 18,000 characters (file diffs are cut first, then sample and preview rows) so the stored tool result (20,000) is whole.
- Storage: no new table. The proposal and the result are the tool results in the task's events (SPEC-tasks-01); `fixes` is an optional field on the task record; the Inbox item gains an optional `fix` object. See ADR 0020.
- Config: `fixes.sandbox` in `operations.yaml` (documented in `docs/operations.example.yaml`).
- HTTP: `POST /api/boards/:id/data` response gains `fixes` (FR-18). No new route.

## Non-functional constraints
- Every statement NerveCenter builds uses names it validated (identifier characters only); no person or agent text is spliced into SQL except the statement the person sees and approves.
- Every read the host runs is bounded (`LIMIT`, `COUNT(*)`).
- The preview runs the reader's widgets with the reader's access.

## Known gaps / deviations
- A previewed widget that uses a filter other than the board's defaults is compared at the defaults only.
- Snowflake has no table version; a change that keeps `lastAlteredAt` and the row count the same is not detected.
- A pipeline that rewrites the target after the fix is not watched; the board marker only says the fix was verified when it was applied.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 to FR-4 | `fix-service.mts`, `sql-scope.mts` | `backend/tests/tested-fixes.test.mjs`, `backend/tests/sql-scope.test.mjs` |
| FR-5 to FR-8 | `fix-service.mts`, `nervecenter-tools.mts` | `tested-fixes.test.mjs`; `frontend/src/features/tasks/cards/fixCards.test.tsx` |
| FR-9 to FR-13 | `fix-service.mts`, `task-runtime.mts`, `ExplainedApproval.tsx`, `InboxPage.tsx` | `tested-fixes.test.mjs`; `fixCards.test.tsx` |
| FR-14 to FR-17 | `fix-service.mts` | `tested-fixes.test.mjs`; `fixCards.test.tsx` |
| FR-18 | `board-service.mts`, `BoardWidgets.tsx` | `tested-fixes.test.mjs`; `frontend/src/features/boards/askAboutWidget.test.tsx` |
| FR-19 | `task-runtime.mts`, plugin reference | `tested-fixes.test.mjs` |

## Open questions
None.
