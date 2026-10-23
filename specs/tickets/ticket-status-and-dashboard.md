---
id: SPEC-tickets-02
title: Ticket status view, agent view and ticket dashboard
status: implemented
area: tickets
owners: []
code:
  - backend/src/app/ticket-view.mjs
  - backend/src/app/operations-service.mjs
  - frontend/src/features/tickets/ticketFields.ts
last_verified: 2026-10-03
---

# Ticket status view, agent view and ticket dashboard

## Purpose
Source systems each have their own states. People see four app statuses everywhere, plus what the agent is doing about the ticket and what kind of work it is. `GET /api/tickets/dashboard` gives a small summary and attention list for ticket surfaces.

## Scope
- In scope: `decorateTicket` fields (`sourceStatus`, `appStatus`, `agent`, `resolvedWithAgent`, `kind`), `GET /api/tickets/dashboard`, frontend source classification.
- Out of scope: the raw status vocabulary stored on tickets (SPEC-tickets-01), agent task (SPEC-tickets-03).

## Actors and permissions
Any authenticated user; results are limited to tickets the caller can access (SPEC-tickets-01 FR-6). No role gate.

## Requirements
- **FR-1** Every ticket returned by list, detail, update, overview and boards SHALL carry `appStatus` in {open, in_progress, waiting_on_you, closed}.
- **FR-2** `appStatus` SHALL be `closed` when raw status is closed, cancelled, resolved or archived; else `waiting_on_you` when `taskStatus === 'waiting'`; else `in_progress` when `taskStatus` is running or queued, the ticket has an owner (assignee string or object with id or name), or raw status is in_progress, waiting or awaiting_approval; else `open`.
- **FR-3** `sourceStatus` SHALL be `metadata.serviceNow.state`, else `metadata.jira.status`, else raw `status`, else null.
- **FR-4** `agent` SHALL be `{ state, label, summary, report, taskId, finishedAt, changes }` where: no `taskId` gives `none` / "Not looked at"; running or queued gives `working` / "Working on it"; waiting gives `waiting` / "Needs you"; failed gives `failed` / "Stopped"; cancelled gives `none` / "Cancelled"; any other task status gives `done` / "Findings ready".
- **FR-5** `resolvedWithAgent` SHALL be true only when the ticket is closed, has a `taskId`, and `taskChanges > 0`.
- **FR-6** `kind` SHALL be `pipeline` when `pipelineId` is set or text (category, type, tags, title) matches pipeline/job fail/load failed/run failed; else `data_quality` for dq/data quality/quality check; else `access` for access/offboard/entitlement/permission; else `other`.
- **FR-7** `GET /api/tickets/dashboard` SHALL return `generatedAt`, `summary { totalOpen, priorityOpen (critical+high), waitingOnYou, resolvedWithAgent }` and up to 12 `attentionItems` for open tickets ordered by priority weight then newest `updatedAt`, each with `id: ticket:<id>`, `href: /tickets/<id>`, `ticketId`, title, `detail: "<id> · <assignee|Unassigned>"`.
- **FR-8** The frontend SHALL classify source as servicenow, jira, pipeline (pipelineId, or source pipeline/databricks/snowflake), data-quality (dq sources, `context.businessCheckId`, or category data_quality), manual (empty/manual/demo-manual) or other, with ServiceNow/Jira taking precedence over pipeline.

## Scenarios
### S1 Assigned ticket
- **Given** raw status `open` and an assignee **Then** `appStatus` is `in_progress`.
### S2 Agent paused for approval
- **Given** `taskStatus: waiting` on an open ticket **Then** `appStatus` is `waiting_on_you` and `agent.state` is `waiting`.
### S3 Fixed with agent
- **Given** a resolved ticket with a task that made 2 changes **Then** `resolvedWithAgent` is true and Overview counts it.
### S4 ServiceNow On Hold
- **Given** a ServiceNow incident in On Hold (imported as `awaiting_approval`, SPEC-tickets-04) **Then** `appStatus` is `in_progress` and `sourceStatus` is "On Hold".

## Interfaces
- HTTP: `GET /api/tickets/dashboard` (`server.mjs:84`; registered before `/api/tickets/:id`).
- Data: derived fields only; inputs are `status`, `taskStatus`, `taskId`, `taskChanges`, `agentSummary`, `agentReport`, `taskFinishedAt`, `assignee`, `metadata`.
- UI: `AppStatusPill`, filters in the Tickets page (SPEC-tickets-05).

## Non-functional constraints
Pure functions, no I/O. The dashboard reads all accessible tickets in memory.

## Known gaps / deviations
- `GET /api/tickets/dashboard` is not called by the frontend (Overview and Tickets compute from `/api/tickets?status=all`); the endpoint is unused and untested.
- `listTickets({status:'active'})` and `appStatus` disagree on `archived` (SPEC-tickets-01).
- Raw status `waiting` (including Jira "In Review"/"Blocked") maps to `in_progress`, not `waiting_on_you`; only a waiting agent task yields `waiting_on_you`, so "waiting on you" never reflects a human-blocked source state.
- Backend `ticketKind` and frontend `isDataQualityTicket`/`sourceKey` use separate heuristics and can disagree.
- `ticket-view.mjs` has no direct unit test; coverage is indirect via board and frontend tests.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `backend/src/app/ticket-view.mjs:19-25` | `backend/tests/boards.test.mjs:82` (open_by_status, indirect) |
| FR-3 | `backend/src/app/ticket-view.mjs:56` | none |
| FR-4 | `backend/src/app/ticket-view.mjs:31-40` | `frontend/src/features/tickets/TicketsPage.test.tsx` (display only) |
| FR-5 | `backend/src/app/ticket-view.mjs:43` | `backend/tests/boards.test.mjs:82` (fixed_with_agent, indirect) |
| FR-6 | `backend/src/app/ticket-view.mjs:46-52` | none |
| FR-7 | `backend/src/app/operations-service.mjs:148-160` | none |
| FR-8 | `frontend/src/features/tickets/ticketFields.ts:14-24` | `frontend/src/features/tickets/TicketsPage.test.tsx:93` (indirect) |

## Open questions
- Should a Jira "In Review" or ServiceNow "On Hold" ticket show as waiting_on_you?
