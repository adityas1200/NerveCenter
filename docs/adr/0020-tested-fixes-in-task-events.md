# 0020. Tested fixes live in task events; NerveCenter applies and verifies them

- Status: accepted (2026-10-13, owner approved the agentic fix proposal in chat)
- Date: 2026-10-13
- Related: specs/tasks/tested-fixes.md (SPEC-tasks-13), specs/tasks/ask-about-this.md (SPEC-tasks-12), ADR 0009, SPEC-tasks-03

## Context
Sonic tests data fixes on a clone because the remediation skill tells it to, but the clone, the tests and the apply all run as raw SQL through Bash, so each one asks for a production approval, and what was tested reaches the person only if Sonic draws it. The approval card shows a command. Nothing checks the table after the fix is applied. An approval also says nothing about whether the table changed between the test and the apply.

## Decision
- NerveCenter's own tools do the work: `create_fix_sandbox`, `run_in_sandbox` and `drop_fix_sandbox` write only inside a sandbox schema named in `operations.yaml` (`fixes.sandbox`), checked by a small SQL scope parser (`backend/src/tasks/sql-scope.mjs`) that allows a fixed list of statement shapes and refuses everything else. They are category `default_write`. `propose_fix` (read) computes the diff, the checks and the board widget previews itself. `apply_fix` (`production_changes`) runs the stored statement.
- The proposal is the `propose_fix` tool result NerveCenter writes into the task's events. `apply_fix` takes only a proposal id and reads the statement, target and snapshot from that stored result, so the agent cannot change what was approved after the person saw it. No new table or file.
- A snapshot (Delta version on Databricks, last-altered time on Snowflake, row count on both) is taken when the fix is proposed and again before it is applied, the way a saved Terraform plan refuses to apply over changed state. A changed table blocks the apply.
- After applying, NerveCenter verifies: it re-runs the checks and the previewed widgets and compares them with what the sandbox gave. The verdict and the touched widgets go on the task record as an optional `fixes` list; the board data response reads it from the 200 most recent tasks to mark widgets.
- The Inbox item for `apply_fix` gains an optional `fix` summary so the Inbox can say what the approval changes.

## Alternatives considered
- Keep raw SQL through Bash and only draw better cards: the approval would still show a command and the apply could differ from what was tested.
- A new `ops_fixes` table with file twin: durable and queryable, but a migration and two stores for data the task events already hold; the board marker is the only cross-task read and is bounded.
- Mark the board record itself: the person applying may not own the board, and writing the spec would bump its cache key.
- Let `run_in_sandbox` ask like other production changes: every test statement would interrupt the person, which is the friction this removes; the sandbox schema is the boundary instead.

## Consequences
- The permission gate is wider: three tools write without asking by default, but only inside a schema an admin named. Reviewers check `sql-scope.mjs`; its tests cover each allowed shape and the refusals (other schema, second statement, GRANT, multi-table insert, CTE writes).
- The proposal and result must stay under the 20,000-character event text limit; the tools cap rows, columns and cell length to stay under 16 KB.
- Tasks from before this change have no `fixes`; readers treat it as empty.
- Rollback: remove the five tools and the prompt lines; stored proposals become plain tool results and the cards fall back to generic cards.
