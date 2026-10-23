---
id: SPEC-tickets-03
title: Ticket to task: automatic triage, Investigate and ticket polling
status: implemented
area: tickets
owners: []
code:
  - backend/src/tasks/ticket-tasks.mjs
  - backend/src/sync/sync-settings.mjs
  - backend/src/api/server.mjs
  - backend/src/bootstrap.mjs
  - backend/src/main.mjs
last_verified: 2026-10-06
---

# Ticket to task: automatic triage, Investigate and ticket polling

## Purpose
One ticket has at most one agent task. A background poller imports tickets from the configured sources and, where enabled, starts a read-only triage task for new ones. A person can start or continue the task from the ticket ("Investigate"). Task state is mirrored back onto the ticket so the Tickets page needs no join.

## Scope
- In scope: `TicketTaskService` (ensureTask, mirror, noteTicketChange, backfillReports, poll, sources), `POST /api/tickets/:id/investigate`, `POST /api/tickets/poll`, sync settings keys.
- Out of scope: the task runtime and permissions (tasks area), the import itself (SPEC-tickets-04), Databricks/GitHub/knowledge sync (SPEC-tickets-06).

## Actors and permissions
- Investigate: any user with `view` on the ticket. `permission` in the body is one of read-only, policy, ask, allow; anything else becomes `policy`.
- `POST /api/tickets/poll`: admin only (`ADMIN_ROUTES`). The scheduled poll runs as the system with `read-only` unless the source sets `permission`.

## Requirements
- **FR-1** `ensureTask(ticketId)` SHALL start a task `{ type: 'ticket', notify: true, permission, context.ticket }` with the triage prompt (one-line summary, evidence check, likely cause, proposed change and approval; read-only), store `taskId`, `taskStatus` and clear `agentSummary` on the ticket, and append a `task.started` event.
- **FR-2** When the ticket already has a non-cancelled task, `ensureTask` SHALL NOT create another. If a user supplied a custom prompt it SHALL send that prompt to the existing task with the requested permission (`messaged: true`); otherwise it SHALL return the existing task (`created: false`). A cancelled task is replaced by a new one.
- **FR-3** `POST /api/tickets/:id/investigate` SHALL answer 404 for an unknown ticket, 403 without view access, 201 when a task was created and 200 otherwise, returning `{ task, created, messaged? }`. It is registered only when the task service exists.
- **FR-4** On every runtime `task` event for a `type: ticket` task whose id equals the ticket's `taskId`, the service SHALL mirror `taskStatus`, `taskChanges`, `taskFinishedAt`, and non-empty `agentSummary` and `agentReport` onto the ticket, skipping the write when nothing changed.
- **FR-5** When the mirrored status first becomes done, failed or waiting the service SHALL append `task.done|failed|waiting` activity ("<Agent> finished", "stopped", "is waiting on you").
- **FR-6** `noteTicketChange` SHALL append a `status: 'ticket'` event to the ticket's non-cancelled task so the agent sees human edits on its next turn; it SHALL NOT start a turn.
- **FR-7** `poll()` SHALL, for each configured source, import via `syncServiceNow({...filters, startTriage:false})` or `syncJira(filters)`; unsupported platforms are reported as `skipped: 'unsupported platform'`; a failing source is recorded as `error` and does not stop the others.
- **FR-8** Sources SHALL be read from workspace `operations.ticketing.app.sources`, else `ticketing.sources`, else a single `ticketing.platform` block (with `auto_create_tasks: false`, cap 3).
- **FR-9** Only when `source.auto_create_tasks` is true SHALL the poll start tasks: candidates are imported tickets with no `taskId` and a non-closed status, ordered critical, high, medium, low, other; at most `max_concurrent_tasks` (default 3, minimum 1) minus the count of ticket tasks currently queued, running or waiting SHALL be started per poll.
- **FR-10** Scheduled polling SHALL be skipped when the app is inactive (`presence.isActive()` false) or `sync.enabled === false` in operations; `force: true` (the admin endpoint) bypasses both and the interval check.
- **FR-11** (Amended 2026-10-06 by SPEC-platform-10 FR-2: a project's own `sync.tickets` cadence wins when set.) The interval SHALL be `sync.intervalValue` x `sync.intervalUnit` (seconds, minutes, hours), else legacy `sync.interval_seconds`, else 15 s. The timer ticks at `min(pollSeconds, 15)` seconds (env `OPS_TICKET_POLL_SECONDS`, default 15) and skips with `not due` until the configured interval elapsed since the last automatic poll. Overlapping polls are skipped.
- **FR-12** `backfillReports()` SHALL run once at startup (skipped when env `OPS_RECOVER_ON_BOOT=0`) and, for tickets with a task but no `agentReport` or `taskFinishedAt`, recover the report from the task's last reply and mirror it; it is idempotent.
- **FR-13** The poller SHALL start unless env `OPS_TICKET_POLLING=0`; first poll runs 5 s after start.

## Scenarios
### S1 One task per ticket, cap respected
- **Given** two open servicenow tickets, `max_concurrent_tasks: 2`, one task already running **When** the poll runs **Then** one task starts, for the higher-priority ticket.
### S2 Person asks a question on a ticket with a task
- **When** Investigate is called with a prompt **Then** the prompt goes to the existing task as a message (`messaged: true`) with the chosen permission.
### S3 Task finishes
- **Given** a mirrored ticket **When** the task reaches done **Then** `taskStatus: done`, `agentSummary`/`agentReport` set, and a `task.done` event exists.
### S4 Auto sync disabled
- **Given** `sync.enabled: false` **Then** scheduled polls return `skipped: 'auto sync disabled'` and no source is called; the admin poll still runs.
### S5 Not yet due
- **Given** interval 30 s and a poll 15 s ago **Then** the poll returns `skipped: 'not due'`.

## Interfaces
- HTTP: `POST /api/tickets/:id/investigate {prompt?, permission?}`, `POST /api/tickets/poll`.
- Config (workspace `operations.yaml`): `sync.enabled`, `sync.intervalValue`, `sync.intervalUnit`, `sync.interval_seconds`, `ticketing.app.sources[] { platform, filters, auto_create_tasks, max_concurrent_tasks, permission }`. Env: `OPS_TICKET_POLL_SECONDS`, `OPS_TICKET_POLLING`.
- Data: ticket fields `taskId, taskStatus, taskChanges, taskFinishedAt, agentSummary, agentReport`.

## Non-functional constraints
- Polling is in-process and single-flight; unref'd timers do not hold the process open.
- Triage tasks default to read-only and `notify: true` (Inbox item when finished).

## Known gaps / deviations
- `docs/DESIGN.md` says triage is "for a new ticket in scope"; in code a ticket is only triaged when its source has `auto_create_tasks: true`, which defaults to false (including the single-block fallback). Manual sync never starts triage (SPEC-tickets-04).
- GitHub and Databricks-created tickets are never auto-triaged; only servicenow and jira sources are polled.
- The cap counts ticket tasks globally (all sources), not per source, although it is configured per source.
- `result.sources[].started` reports the cumulative `created.length`, not the per-source count.
- A ticket reopened after its task finished keeps its old task; no new triage runs.
- No test for `ensureTask` with a custom prompt, `backfillReports` beyond the main test, or the `/investigate` 403/200/201 paths (only the 404 is covered).

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `backend/src/tasks/ticket-tasks.mjs:33-46` | `backend/tests/tasks.test.mjs:264` |
| FR-3 | `backend/src/api/server.mjs:91` | `backend/tests/api.test.mjs:74` (404 only) |
| FR-4, FR-5 | `backend/src/tasks/ticket-tasks.mjs:49-62` | `backend/tests/tasks.test.mjs:264` |
| FR-6 | `backend/src/tasks/ticket-tasks.mjs:65-69`, `backend/src/bootstrap.mjs:63` | `backend/tests/tasks.test.mjs:264` |
| FR-7, FR-8 | `backend/src/tasks/ticket-tasks.mjs:73-83`, `:114-135` | `backend/tests/tasks.test.mjs:264` |
| FR-9 | `backend/src/tasks/ticket-tasks.mjs:135-141` | `backend/tests/tasks.test.mjs:264` |
| FR-10 | `backend/src/tasks/ticket-tasks.mjs:114-125` | `backend/tests/tasks.test.mjs:357`, `:374` |
| FR-11 | `backend/src/sync/sync-settings.mjs:1-30`, `backend/src/tasks/ticket-tasks.mjs:85` | `backend/tests/tasks.test.mjs:18`, `:30` |
| FR-12 | `backend/src/tasks/ticket-tasks.mjs:93-112` | `backend/tests/tasks.test.mjs:264` |
| FR-13 | `backend/src/main.mjs:29-30` | none |

## Open questions
- Should the concurrency cap be per source as configured?
