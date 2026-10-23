---
id: SPEC-tasks-02
title: Ticket tasks (one task per ticket, triage poller, mirroring)
status: implemented
area: tasks
owners: []
code:
  - backend/src/tasks/ticket-tasks.mjs
  - backend/src/api/server.mjs
  - backend/src/bootstrap.mjs
  - backend/src/main.mjs
last_verified: 2026-10-03
---

# Ticket tasks

## Purpose
Each ticket has at most one agent task. New in-scope tickets can get an automatic read-only triage; a person can start or continue the task from the ticket ("Investigate"). Task state is mirrored onto the ticket so the Tickets page needs no join.

## Scope
- In scope: `TicketTaskService.ensureTask`, mirroring, `noteTicketChange`, polling with per-source caps, report backfill, `POST /api/tickets/:id/investigate`, `POST /api/tickets/poll`.
- Out of scope: ticket CRUD and ServiceNow/Jira sync internals (tickets area), the task runtime (SPEC-tasks-01).

## Actors and permissions
- Investigate: any user who can `view` the ticket (`authorizeTicket(...,'view')`).
- `POST /api/tickets/poll` is admin-only (`ADMIN_ROUTES`).
- Poller acts as system (no user), permission from the source config.

## Requirements
- **FR-1** `ensureTask(ticketId)` SHALL 404 for an unknown ticket, and SHALL return the existing task (`created:false`) when the ticket has one that is not `cancelled`.
- **FR-2** When a user supplies a custom prompt and an existing non-cancelled task exists, the service SHALL send it as a follow-up message (with the requested permission) and return `{messaged:true, queued}` instead of a new task.
- **FR-3** Otherwise it SHALL start a `type:'ticket'` task titled by ticket title/failure summary/id, `notify:true`, context `{ticket: ticketContext}`, set `ticket.taskId`, `taskStatus`, clear `agentSummary`, and append activity `task.started`.
- **FR-4** The default prompt SHALL be the read-only triage prompt (summary line, evidence check, likely cause, exact change and approval; ends with a recommendation not a question).
- **FR-5** On every runtime `task` event for a ticket task whose id equals `ticket.taskId`, the service SHALL mirror `taskStatus`, `taskChanges`, `taskFinishedAt`, `agentSummary`, `agentReport`, skipping the write when nothing changed.
- **FR-6** On entering `done`, `failed` or `waiting` it SHALL append a ticket activity (`task.done|failed|waiting`) once per transition.
- **FR-7** `noteTicketChange` SHALL append a `status` event (`status:'ticket'`) to the ticket's task unless the task is cancelled or missing, so the agent sees human edits on its next turn.
- **FR-8** `poll` SHALL skip (unless `force`) when the app is inactive or the workspace auto-sync switch is off, and SHALL not run concurrently with itself.
- **FR-9** For each configured source (`ticketing.app.sources` else `ticketing.sources`, else the single `ticketing` block with a `platform`) it SHALL import tickets (ServiceNow with `startTriage:false`, Jira), and report `unsupported platform` for others.
- **FR-10** Only when `auto_create_tasks` is true SHALL it start tasks, for imported tickets without `taskId` and not closed (`closed|cancelled|resolved|archived`), ordered by priority (critical, high, medium, low), up to `max(1, max_concurrent_tasks||3) - running` where running counts all `ticket` tasks in `queued|running|waiting`; permission = `source.permission || 'read-only'`.
- **FR-11** The poll interval SHALL be `OPS_TICKET_POLL_SECONDS` (default 60) with a first poll after 5 s; `OPS_TICKET_POLLING=0` disables it.
- **FR-12** `backfillReports` (at boot unless `OPS_RECOVER_ON_BOOT=0`) SHALL, for tickets whose task is done/failed/waiting and lack `agentReport` or `taskFinishedAt`, derive the report from the last top-level reply or `result` event and mirror it; idempotent.
- **FR-13** `POST /api/tickets/:id/investigate` SHALL accept `permission` in the four values (default `policy`) and optional `prompt`; respond 201 when a task was created, else 200.

## Scenarios
### S1 Auto triage under a cap
- **Given** a source with `auto_create_tasks` and cap 2, three new tickets
- **When** the poller runs
- **Then** the two highest priority get read-only tasks; the third waits for the next poll.

### S2 Mirror
- **Given** a ticket with a task
- **When** the task becomes `done` with a summary
- **Then** the ticket shows `taskStatus:'done'`, `agentSummary` and one `task.done` activity.

### S3 Specific question on a triaged ticket
- **Given** a ticket whose task is `done`
- **When** a user investigates with a prompt
- **Then** the prompt is sent to the same task, not a new one.

## Interfaces
- HTTP: `POST /api/tickets/:id/investigate {permission?,prompt?}`; `POST /api/tickets/poll` (admin).
- Config: `operations.yaml ticketing.app.sources[] {platform, connection, filters, auto_create_tasks, max_concurrent_tasks, permission}`.
- Ticket fields: `taskId, taskStatus, taskChanges, taskFinishedAt, agentSummary, agentReport`.

## Non-functional constraints
- Poll timer is `unref`'d; errors are logged, never thrown into the loop.
- Cap counts tasks across all sources of type `ticket`, not per source.

## Known gaps / deviations
- The comment on `ensureTask` says Investigate uses `ask`; the route defaults to `policy`.
- Cap is global across sources although configured per source; `started` in the per-source result reports the cumulative created count.
- DESIGN.md says ticket edits post a status line into the task; this works only through `operationsService.onTicketChange`, wired in bootstrap, and is untested.
- A cancelled task is replaced silently by a new task on the next ensure, orphaning the old `taskId`.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1..FR-3 | `backend/src/tasks/ticket-tasks.mjs:33-46` | `backend/tests/tasks.test.mjs:234` |
| FR-4 | `ticket-tasks.mjs:14-19` | `backend/tests/tasks.test.mjs:234` (partial) |
| FR-5, FR-6 | `ticket-tasks.mjs:49-62` | `backend/tests/tasks.test.mjs:234` |
| FR-7 | `ticket-tasks.mjs:65-69`, `backend/src/bootstrap.mjs:68` | none |
| FR-8 | `ticket-tasks.mjs:114-118` | `backend/tests/tasks.test.mjs:327,344` |
| FR-9, FR-10 | `ticket-tasks.mjs:73-83,120-134` | `backend/tests/tasks.test.mjs:234` |
| FR-11 | `ticket-tasks.mjs:12,85`, `backend/src/main.mjs:30` | none |
| FR-12 | `ticket-tasks.mjs:93-111` | `backend/tests/tasks.test.mjs:234` |
| FR-13 | `backend/src/api/server.mjs:91` | none |

## Open questions
- Should the cap be per source as configured?
