---
id: SPEC-tasks-04
title: Agent tools (in-process NerveCenter MCP server)
status: implemented
area: tasks
owners: []
code:
  - backend/src/tasks/nervecenter-tools.mts
  - backend/src/bootstrap.mjs
  - frontend/src/features/tasks/cards/cards.ts
  - frontend/src/features/tasks/taskEvents.ts
last_verified: 2026-10-16
---

# Agent tools

## Purpose
Give the agent NerveCenter's own data and a way to "show its work": an in-process MCP server named `nervecenter` (tool names `mcp__nervecenter__*`) that reads tickets, pipelines, data quality, tasks, approvals, routines, people and knowledge, writes tickets and boards, and draws plans, findings, tables, timelines, comparisons, metrics and artifacts as cards in the task.

## Scope
- In scope: tool set, schemas, per-task identity, write tools' `reason`, display tools (no-op echo), the UI contract that turns `tool.use` events into cards (`cards.ts`, `groupEvents`).
- Out of scope: gating verdicts (SPEC-tasks-03), card rendering details (SPEC-tasks-06), board service internals.

## Actors and permissions
- Each call runs as the task creator: the stored role is resolved via `rbacStore.overlay` + `resolveRole`, so ticket and board permissions of that person apply. A task created by `system` (or no creator) runs as agent `nervecenter-agent` with role `admin`.
- Write tools are marked `readOnlyHint:false` and go through the permission gate; all other tools are read.

## Requirements
- **FR-1** `createAppTools(...)` SHALL return a function `(task, sdk) => sdk.createSdkMcpServer({name:'nervecenter', version:'1.0.0', tools})`, built per task, with every tool `alwaysLoad`. Errors thrown by a handler SHALL be returned as `isError` text `Error: <message>`, never thrown.
- **FR-2** The runtime SHALL attach the server as `mcpServers.nervecenter` only when `appTools` is set and the SDK exposes `createSdkMcpServer`.
- **FR-3** Read tools SHALL be: `app_overview` (open tickets by status/priority, mine, unassigned, pipelines failed/running, DQ failures, waiting-on-people, running tasks), `list_tickets` (status, priority[], source, assignee `me|unassigned|name`, text words incl. `dq`, limit<=200, sorted by priority then `updatedAt`), `get_ticket` (by `OPS-` id or source number; last 25 activities), `list_pipelines` (status, text, range), `get_pipeline_runs` (limit<=50), `data_quality_results`, `list_tasks`, `get_task`, `list_approvals` (pending non-notification items), `list_routines`, `list_people` (unblocked users), `search_knowledge`.
- **FR-4** `search_knowledge` SHALL walk `knowledge/` (depth 8, <=2000 `.md|.markdown|.txt` files, 400 KB each), score by query-word counts (max 5 per word, +4 for a title hit, words >= 2 chars), return top `limit` (default 5, max 10) with path, title, snippet and `readPath`, or a note when no folder is configured.
- **FR-5** Ticket write tools `comment_on_ticket`, `assign_ticket` (`me`, `unassigned`, a person), `set_ticket_status` (`open|in_progress|waiting|resolved|closed|cancelled`; resolved/closed SHALL require a non-empty `resolution`), `link_ticket_to_source`, `create_ticket` (title >= 3, visibility `operators`, creator = acting user, no assignee) SHALL each require `reason` (3..240 chars) and operate through `operationsService` as the acting user.
- **FR-6** Board tools (only when a board service exists): read `list_boards`, `get_board`, `list_board_sources`, `preview_board_widget`; write (with `reason`) `create_board` (draft, <=16 widgets, <=6 filters), `update_board`, `publish_board`, `delete_board`.
- **FR-7** Display tools SHALL change nothing and return `{shown:true,...}`. Since 2026-10-11 they are the component catalog of SPEC-tasks-10, defined once in `backend/src/tasks/ui-catalog.mjs` (FR-12, FR-13): `propose_plan` (1..7 steps with id, text, kind read|change|check; returns `planId`, steps in state `pending`), `update_plan` (`stepId`, state active|done|skipped|blocked, note<=240), `record_finding` (kind hypothesis|evidence|ruled_out|root_cause|fix|verification|inconclusive, text<=600, optional `id`, `hypothesisId`, `confidence`, <=8 evidence refs), `show_table` (<=8 columns, <=50 rows), `show_timeline` (2..20 events), `show_comparison` (<=12 rows), `show_metrics` (1..4 tiles), and the newer components listed in SPEC-tasks-10 FR-13.
- **FR-8** `show_artifact` SHALL accept a path under the task folder (`tasks/<this-id>/x` or `x`), reject another task's folder, `..`, absolute paths and extensions other than html/htm/svg/png/jpg/jpeg/gif/webp/md/markdown/pdf, and return `{path (relative), title, kind (default by extension), summary}`; it SHALL NOT verify the file exists.
- **FR-9** The UI SHALL derive cards from the stored top-level `tool.use` events, not from results, except the data-bound `show_ticket` and `show_pipeline_runs`, which draw their result (SPEC-tasks-10 FR-14): every catalog component becomes a component in the thread (`cards/blocks.ts`), `show_artifact` an artifact frame, `propose_plan` the plan card (the last proposal wins, later `update_plan` calls fold in by `stepId`), a turn's `record_finding` calls one investigation card; `update_plan`, `set_outcome`, `request_input`, `explain_action` and `AskUserQuestion` are not listed as steps, and the matching `tool.result` is hidden.
- **FR-10** The runtime SHALL tell the agent (system prompt) to call `propose_plan` before the first change in ticket/routine tasks (only for >2 changing steps in chats), `record_finding` during investigations, `show_artifact` for HTML reports it writes into the task folder, and to answer data with the catalog's components, whose one-line uses are generated from the catalog (SPEC-tasks-10 FR-22).
- **FR-11** The agent asks people questions through the SDK `AskUserQuestion` tool, which the runtime handles itself: 1..4 questions (question <=600, header <=24, `multiSelect`, <=4 options with label <=80 and description <=300), creating a `question` Inbox item and a `question.asked` event and pausing the task until answered, skipped, or cancelled. A tool call with no questions SHALL be denied with an instruction to ask again.
- **FR-12** `list_tasks` SHALL accept `since` (an ISO date or time) and return only the tasks updated at or after it, taken from the newest `limit` tasks by update time (default 20, max 100). An unreadable `since` SHALL be a tool error. Each row SHALL carry `updatedAt` and `finishedAt`. When every row read matched `since` and the read hit `limit`, the result SHALL carry a `note` that more may match.
- **FR-13** `get_task_log` (read category, no extra permission) SHALL return one task's conversation for review, read through the task's project: a task from another project SHALL be the error "No task <id> in this project", with nothing about it returned. The result SHALL carry the task header (id, title, type, status, permission, started by, created and finished times, cost, turns, ticket), `signals` counted over the whole task (person messages, agent replies, tool calls, tool errors, findings, approvals asked, approved, rejected, blocked, questions asked and answered, interruptions, cancels, errors, subagent steps, and edits from `historyVersion`), and `entries`: one compact entry per top-level event, with long text clipped. Tool names SHALL drop the `mcp__nervecenter__` prefix; `record_finding` SHALL be a `finding` entry; the echo results of display tools SHALL be left out, while their input stays; subagent steps SHALL be counted, not listed. Entries SHALL come in pages of at most 300 entries and about 60 KB, starting after `afterSeq`, with `nextAfterSeq` set while more remain and null on the last page. At most 10,000 events SHALL be read, with a `note` when that cap is hit.

FR-12 and FR-13 were requested and approved in chat on 2026-10-16, so a routine can review recent tasks with the `evaluate` skill.

## Scenarios
### S1 Cards echo and change nothing
- **Given** a task
- **When** the agent calls `propose_plan`, `update_plan`, `record_finding`, `show_table`, `show_metrics`
- **Then** each returns `shown:true`, nothing in tickets or files changes, and the thread draws a plan checklist, finding and table.

### S2 Every write has a reason
- **Given** `ask` mode
- **When** the agent calls `comment_on_ticket` with a reason
- **Then** the approval shows the reason, and resolving without a resolution fails with a tool error.

### S3 Artifact path
- **Given** a task `T-5`
- **When** `show_artifact` gets `tasks/T-9/report.html`
- **Then** it errors "must be a file inside this task's folder".

### S4 Question
- **Given** an `AskUserQuestion` call with two options
- **When** the person answers in the Inbox
- **Then** the tool call continues with `answers` and the task is `running`; if skipped the agent is told to use its judgement.

## Interfaces
- MCP server `nervecenter`; tool ids `mcp__nervecenter__<tool>`; `PAGE_TOOLS` in the runtime maps a page name (Boards, Overview, Tickets, Pipelines, Data quality, Tasks, Inbox, Routines, Connectors, Settings) to the tool the agent should call first.
- Events consumed by the UI: `tool.use` (name, input JSON), `question.asked`, `question.answered`.

## Non-functional constraints
- Handlers return JSON text (indent 1); long fields are clipped (400 chars default; descriptions 4000, task replies 3000).
- Display tool inputs are stored as event input (strings cut at 8000) and drive the UI; the echo return value is not used by the UI.

## Known gaps / deviations
- The server hands `readOnlyHint:true` to display tools although they have visible effect; they are `read` category so never gated.
- Display tool inputs are only validated by zod, not by content: an artifact path may point at a missing file (frame shows an error), and plan step ids are not checked against earlier plans.
- The `reason` of `link_ticket_to_source`, `comment_on_ticket`, etc. is not stored with the ticket, only shown on the approval and thread.
- `list_tickets` text filter uses regex built from user words (escaped except the `dq` alias).
- Tests assert echo output and categories, not the UI mapping for `record_finding` (see investigation tests) or board tools.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/tasks/nervecenter-tools.mts:109-123` | `backend/tests/agent-tools.test.mjs:75` |
| FR-2 | `backend/src/tasks/task-runtime.mts:384`, `backend/src/bootstrap.mjs:68` | `backend/tests/agent-tools.test.mjs:75` |
| FR-3 | `nervecenter-tools.mts:135-227` | `backend/tests/agent-tools.test.mjs:75` (partial) |
| FR-4 | `nervecenter-tools.mts:33-70,313-315` | `backend/tests/agent-cards.test.mjs:85` |
| FR-5 | `nervecenter-tools.mts:229-257` | `backend/tests/agent-tools.test.mjs:75,118`, `backend/tests/agent-cards.test.mjs:54` |
| FR-6 | `nervecenter-tools.mts:95-107` | none |
| FR-7 | `ui-catalog.mjs`, `nervecenter-tools.mts` | `backend/tests/agent-cards.test.mjs:20` |
| FR-8 | `nervecenter-tools.mts:298-311` | `backend/tests/agent-cards.test.mjs:20` (partial) |
| FR-9 | `frontend/src/features/tasks/taskEvents.ts`, `cards/blocks.ts`, `cards/cards.ts` | `cards.test.tsx`, `artifacts.test.tsx`, `catalog.test.tsx`, `thread.test.tsx` |
| FR-10 | `backend/src/tasks/task-runtime.mts`, `ui-catalog.mjs` `catalogPromptLines` | `backend/tests/ui-catalog.test.mjs` |
| FR-11 | `task-runtime.mts:470-487` | `backend/tests/questions.test.mjs:30,58` |
| FR-12 | `nervecenter-tools.mts` `list_tasks` | `backend/tests/agent-task-log.test.mjs` |
| FR-13 | `nervecenter-tools.mts` `taskLog`, `get_task_log`; `nervecenter-tool-categories.mjs` | `backend/tests/agent-task-log.test.mjs` |

## Open questions
- Should display tools be validated against real events (file exists, step ids)?
