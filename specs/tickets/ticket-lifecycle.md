---
id: SPEC-tickets-01
title: Ticket lifecycle (list, create, view, update, comment, activity)
status: implemented
area: tickets
owners: []
code:
  - backend/src/app/operations-service.mjs
  - backend/src/app/operations-store.mts
  - backend/src/api/server.mjs
  - frontend/src/api/tickets.ts
last_verified: 2026-10-06
---

# Ticket lifecycle

## Purpose
One ticket record per piece of work, whether it was typed in, raised from a failed pipeline run, or imported from ServiceNow, Jira or GitHub. People list, open, assign, resolve, comment on and reopen tickets, and every change lands on a timeline. Serves operators and business users of the Tickets page and the agent's ticket tools.

## Scope
- In scope: `/api/tickets*` CRUD behaviour in `OperationsService`, per-ticket access and permissions, activity log, source write-through on edit and comment, ticket id allocation and idempotent creation.
- Out of scope: status derivation and dashboard (see SPEC-tickets-02), agent task (SPEC-tickets-03), import from ServiceNow/Jira (SPEC-tickets-04), UI (SPEC-tickets-05).

## Actors and permissions
- Role gate: none. Ticket routes are not in `ADMIN_ROUTES`; any authenticated user, including `viewer`, reaches them (see Known gaps).
- Per-ticket (`canAccess`/`permissionFor`): admin and single-user identity can do everything. Otherwise a user can view/comment if they are creator, requester, assignee or collaborator, the ticket is `visibility: 'operators'`, or they are the routed approver. `assign` and `close` need creator or assignee ("owner"). `approve` needs the routed approver (or owner when none is routed). `executeAction` needs the assignee.

## Requirements
- **FR-1** `POST /api/tickets` without `pipelineId`/`runId` SHALL require a non-empty `title`, create a ticket with `status: open`, id `<config.ticketPrefix>-<n>` (file store counter starts at 1001, Postgres uses sequence `ops_ticket_seq`), `visibility` default `private`, `category` default `task`, priority normalised to one of critical/high/medium/low (default `medium`), and answer 201.
- **FR-2** The creator SHALL be the caller; `assignee` SHALL default to the caller unless the body contains an `assignee` key (including `null`, which means unassigned).
- **FR-3** When `sourceRef` is given, a second create with the same `source:sourceRef` (source default `manual`) SHALL return the existing ticket instead of a new one.
- **FR-4** When `pipelineId` and `runId` are given they SHALL be given together and refer to a run whose status is in failed/error/timedout/canceled/cancelled/internal_error; otherwise the call SHALL fail with a plain error. The ticket SHALL get `category: incident`, `type: pipeline_failure`, title `Failed pipeline: <name>`, `sourceKey: <platform>:<pipelineId>:<runId>`, and `visibility: operators` when `assignee` is null.
- **FR-5** Every new ticket SHALL start with one `ticket.created` activity event ("Ticket opened").
- **FR-6** `GET /api/tickets?status=active|closed|all&source=<s|all>` SHALL return `{ items }` filtered to tickets the caller can access, each decorated (SPEC-tickets-02). `active` (default) excludes status closed/cancelled/resolved; `closed` returns only those.
- **FR-7** `GET /api/tickets/:id` SHALL return the decorated ticket plus `approver` (stored or routed from `config.approverRouting` by category, type, then `pipeline_failure`, then `default`) and `permissions { canView, canComment, canAssign, canApprove, canClose, canExecuteAction }`. Unknown id: 404. No access: 403.
- **FR-8** `PATCH|PUT /api/tickets/:id` SHALL accept `priority, category, type, title, description, sourceRef, context, metadata, resolutionSummary, waitingReason, status, assignee, collaborators` and ignore other keys. `status` SHALL be one of open, in_progress, waiting, resolved, closed, cancelled, else error "Invalid ticket status".
- **FR-9** Changing `assignee` or `collaborators` SHALL need `assign`, except that anyone with access MAY claim an unowned ticket by assigning themselves. Setting a terminal status (closed/resolved/cancelled) SHALL need `close`. Any other edited field or non-terminal status SHALL need `assign`. Violations: 403.
- **FR-10** A terminal status SHALL set `closedAt` to now; open, in_progress or waiting SHALL clear it.
- **FR-11** For tickets whose `externalReference.system` is servicenow or jira, the changed status, resolution, assignee, priority, title and description SHALL be written to the source first; if the source refuses, the call SHALL fail with 502 "Not saved. <System> did not accept the change: ..." and NerveCenter's copy SHALL stay unchanged. On success the response SHALL include `sourceWrite { system, name, number, written[] }`. Tickets with no external reference SHALL skip this step.
- **FR-12** Assignee, status and priority changes SHALL append `ticket.assigned`, `ticket.status`, `ticket.priority` events (actor recorded) and call `onTicketChange`, which forwards the change to the ticket's task (SPEC-tickets-03).
- **FR-13** `POST /api/tickets/:id/comments {body}` SHALL need `comment`, reject an empty body, append a `ticket.comment` event (201 `{ ticketId, event, sourceWrite }`), and write it to the source as a ServiceNow work note or Jira comment suffixed "via NerveCenter".
- **FR-14** `GET /api/tickets/:id/activity` SHALL need `view` and return `{ ticketId, items }` newest first, at most the latest 1000 events. Every ticket read (single ticket and list rows) carries its latest 500 events as `activity`, oldest first; a list loads them with one query, not one per ticket (ADR 0005).
- **FR-15** Identity matching across systems SHALL treat two references as the same person when id, email, email local part or name agree (case-insensitive).
- **FR-16** `linkTicketToSource` (agent tool only, no HTTP route) SHALL attach a ServiceNow/Jira reference to an unlinked ticket, refuse when already linked or when the source key belongs to another ticket, and log a `ticket.synced` event.

## Scenarios
### S1 Create, comment, resolve
- **Given** user alice **When** she POSTs `{title, priority:'high'}` **Then** 201, id matches `^OPS-\d+$`, assignee is alice.
- **When** she comments then PATCHes `{status:'resolved', resolutionSummary}` **Then** activity types are `ticket.status, ticket.comment, ticket.created` newest first.
### S2 Claim an unowned ticket
- **Given** an operators-visible ticket with no assignee **When** bob PATCHes `{assignee: bob}` **Then** allowed without `assign`; handing it to carol instead returns 403.
### S3 Source refuses a change
- **Given** a Jira ticket **When** Jira rejects the transition **Then** 502 and the stored status is unchanged.
### S4 Idempotent manual create
- **Given** a ticket with `source: x, sourceRef: r` **When** the same pair is created again **Then** the first ticket is returned.
### S5 Non-failed run
- **When** creating a ticket for a succeeded run **Then** error "Tickets can be created only for failed pipeline runs".

## Interfaces
- HTTP: `GET/POST /api/tickets`, `GET/PATCH/PUT /api/tickets/:id`, `POST /api/tickets/:id/comments`, `GET /api/tickets/:id/activity` (`backend/src/api/server.mjs:85-98`). Errors without a `statusCode` return 400; `statusCode >= 500` is logged.
- Data: file store `tickets` map + `ticketCounter`; Postgres `ops_tickets (ticket_id, status, source_key, data jsonb)`. `createTicket` in the store upserts by `sourceKey` (or `externalReference.system:sysId`) and `mergeExisting` keeps ticketId, createdAt, creator, closedAt and taskId. Activity is not part of the ticket record: it is one row per event in `ops_ticket_events (ticket_id, seq, id, at, type, data)` (file store: `ticket-events/<ticketId>.json` beside the state file), appended with `appendActivity` (seq assigned by the insert, retried on a key clash) and never set through `updateTicket`; a re-import keeps the existing events and adds none (ADR 0005, migration 010).
- Config: `ticketPrefix`, `approverRouting`, `identityMode`, `defaultUserId`, `adminUserIds`, `adminRole`.

## Non-functional constraints
- Ticket writes are serialised by the store's `#exclusive` lock; Postgres `listTickets` is capped at 5000 rows.
- Activity events carry actor id and name; source writes append the actor's name in the source text.

## Known gaps / deviations
- No role gate: a `viewer` can create, edit (own tickets), comment and start investigations; RBAC docs say viewers change nothing.
- `startTriage` is sent by the UI and stripped by the route (`server.mjs:77`), never acted on.
- `listTickets` treats `archived` as active while `decorateTicket`/`isClosed` treat it as closed; `archived` is not an accepted PATCH status.
- Source write-through covers status, resolution, assignee, priority, title, description only; `category`, `type` and `collaborators` stay local, and an import overwrites imported fields such as category, tags and priority from the source.
- Pipeline-path create does not check for an existing ticket before burning an id; the store merge makes it idempotent but the merge overwrites title/description of the existing ticket.
- Validation errors (empty title, bad status, bad assignee) return 400 via the default; only access errors set 403/404.
- Only the happy path of create/list/comment/update/activity has an API test; access rules, claiming, 502 write-through, link-to-source and the pipeline path are untested.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2, FR-5 | `backend/src/app/operations-service.mjs:339-364` | `backend/tests/api.test.mjs:29` |
| FR-3 | `backend/src/app/operations-service.mjs:355` | none |
| FR-4 | `backend/src/app/operations-service.mjs:340-352` | none |
| FR-6 | `backend/src/app/operations-service.mjs:444` | `backend/tests/api.test.mjs:33` |
| FR-7 | `backend/src/app/operations-service.mjs:453`, `:50-71` | `backend/tests/api.test.mjs:35` |
| FR-8, FR-9, FR-10 | `backend/src/app/operations-service.mjs:457-484` | `backend/tests/api.test.mjs:39` (resolve only) |
| FR-11 | `backend/src/app/operations-service.mjs:486-515` | none |
| FR-12 | `backend/src/app/operations-service.mjs:517-527` | `backend/tests/api.test.mjs:42` (types only) |
| FR-13 | `backend/src/app/operations-service.mjs:529-540` | `backend/tests/api.test.mjs:37` |
| FR-14 | `backend/src/app/operations-service.mjs:553` | `backend/tests/api.test.mjs:41` |
| FR-15 | `backend/src/app/operations-service.mjs:38-46` | none |
| FR-16 | `backend/src/app/operations-service.mjs:542`, `backend/src/tasks/nervecenter-tools.mjs:249` | none |

## Open questions
- Should viewers be blocked from ticket writes at the route level?
