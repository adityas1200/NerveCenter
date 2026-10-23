---
id: SPEC-tickets-04
title: ServiceNow and Jira ticket import, status and write-back
status: implemented
area: tickets
owners: []
code:
  - backend/src/connectors/servicenow/servicenow-service.mjs
  - backend/src/connectors/jira/jira-service.mjs
  - backend/src/app/operations-service.mjs
  - backend/src/app/operations-store.mts
  - backend/src/api/server.mjs
  - backend/src/app/rbac.mjs
  - frontend/src/features/tickets/TicketDialogs.tsx
last_verified: 2026-10-06
---

# ServiceNow and Jira ticket import, status and write-back

## Purpose
Operators want incidents and issues from ServiceNow and Jira in one ticket list, kept current, and edits made in NerveCenter to land in the source. An admin can preview and import a controlled set; the poller (SPEC-tickets-03) does the same on a schedule.

## Scope
- In scope: connection status, preview, sync endpoints; query building and field mapping for both systems; closing tickets that left the active scope; source writes (status, assignee, priority, title, description, comment).
- Out of scope: the agent's own Jira/ServiceNow writes through MCP, GitHub PR tickets (SPEC-tickets-06).

## Actors and permissions
- `GET .../status`, `POST .../preview`: any authenticated user.
- `POST /api/integrations/servicenow/sync`, `POST /api/integrations/jira/sync`: admin only (`rbac.mjs` ADMIN_ROUTES).
- Credentials come from the default connection profile (provider `servicenow` or `jira`) plus the secret store; ServiceNow also falls back to env (`config.serviceNowInstance`, username, `SERVICENOW_PASSWORD`).

## Requirements
- **FR-1** `status` SHALL return `{ mode: 'disabled'|'live', configured, ready, reason?, ... }`; with `?verify=1` it SHALL also run a one-row query to prove the credential. Jira status SHALL add `defaultJql` from `ticketing.app.sources[platform=jira].filters.jql`; ServiceNow status always returns `assignmentGroups: []`.
- **FR-2** ServiceNow queries SHALL read `/api/now/table/incident` with `sysparm_limit` clamped to 1..2000 (default 50), display values on, and encoded query = configured base (`config.serviceNowQuery`, default `active=true`) plus assignment group, `stateIN`, `priorityIN`, `sys_tagsLIKE`, `sys_updated_on>=gs.hoursAgo(n)`. State and priority filters SHALL accept display names, NerveCenter names or raw codes. `numbers` SHALL replace the base query with `numberIN...`.
- **FR-3** ServiceNow rows SHALL map to tickets: `sourceKey servicenow:<sys_id>`, `externalReference { system, sysId, number, url }`, status New/1 -> open, In Progress -> in_progress, On Hold -> awaiting_approval, Resolved/Closed/Canceled -> closed (unknown -> open), priority 1..5 -> critical/high/medium/low/low, assignee and requester as `{type:'user', id: email|name, name, email?}`, timestamps normalised to ISO UTC.
- **FR-4** Jira search SHALL POST `/rest/api/3/search/jql` in pages of 100 using `nextPageToken`, stop on `isLast`, an empty page, a repeated token, the requested limit or a 2000 ceiling. Default JQL is `project = "<key>" AND statusCategory != Done [AND updated >= -<n>h] ORDER BY priority DESC, updated DESC`; explicit `jql` wins; `keys` (valid issue keys) replaces the query with `key in (...)`.
- **FR-5** Jira issues SHALL map to tickets: `sourceKey jira:<issue.id>`, number = issue key, status via name table (To Do -> open, In Progress -> in_progress, In Review/Blocked/On Hold -> waiting, Done/Closed -> closed, Resolved -> resolved, Cancelled -> cancelled) else status category (done -> closed, indeterminate -> in_progress, else open), priority Highest/Blocker/Critical -> critical, High/Major -> high, Low/Lowest/Minor/Trivial -> low, else medium; category from labels (dq/quality, pipeline/job, access) else issue type; ADF descriptions flattened to text.
- **FR-6** Sync SHALL upsert each returned item by `sourceKey`: an existing ticket keeps its `ticketId`, `createdAt`, `creator`, `closedAt`, its activity events (stored apart from the ticket, ADR 0005), `taskId`, `workflowIds`, `resolutionSummary` and `visibility`, takes the source's fields, and (store merge) takes the source's assignee when one is sent. New tickets get visibility `operators` and an `Imported from ServiceNow|Jira` event. Priority SHALL be normalised to critical/high/medium/low.
- **FR-7** After each sync, tickets of that source with an external number that were not returned and are not closed/cancelled/resolved SHALL be looked up by number or key in batches of 50; if the source status differs, the ticket SHALL take the new status, `closedAt` when terminal, merged metadata, and a `ticket.synced` event ("Closed in <System>" or "Status changed in <System>"). A lookup failure stops the refresh silently.
- **FR-8** The sync response SHALL be `{ synced, closed, total, instance|site, source, query?, filters?, tickets }`; preview SHALL be `{ total, matched, alreadyImported, instance|site, source, query, sample (10) }` and write nothing.
- **FR-9** Writes (SPEC-tickets-01 FR-11): ServiceNow SHALL PATCH the incident with display values: `state` (New, In Progress, On Hold, Resolved, Closed, Canceled), `close_code` "Solved (Permanently)" and `close_notes` when resolved or closed, `assigned_to` (email, else name, else id; empty to unassign), `priority` ("1 - Critical" ... "4 - Low"), `short_description`, `description`, and comments as `work_notes`. Jira SHALL post a comment, assign by account id (lookup by email or name; fail if none), PUT summary/description/priority (Highest/High/Medium/Low), and transition to a status in the target category (new, indeterminate, done).
- **FR-10** For a Jira move to the done category the target status name SHALL decide: resolving or closing prefers Done/Resolved/Completed names, cancelling prefers Cancelled/Won't Do/Rejected/Duplicate; transitions Jira marks unavailable are skipped when an available one exists; no match throws "Jira has no transition to a ... status".
- **FR-11** Each upstream call SHALL time out (ServiceNow list/update 15 s, Jira search 20 s, Jira write 15 s); errors SHALL be passed through a redactor.

## Scenarios
### S1 Preview then import
- **Given** a ready ServiceNow connection **When** the admin previews with group "Data Ops" **Then** `matched`, `alreadyImported` and up to 10 sample rows return and no ticket is stored; importing stores them and refreshes already imported ones.
### S2 Closed upstream
- **Given** INC1 imported earlier **When** a later sync no longer returns it and a lookup by number shows Resolved **Then** the ticket is closed with a "Closed in ServiceNow" event.
### S3 Cancel in Jira
- **Given** a workflow listing "Cancelled" before "Done" **When** a ticket is resolved **Then** Jira lands on Done; when cancelled it lands on Cancelled.
### S4 Jira pagination bug
- **Given** Jira repeats the same `nextPageToken` **Then** the search stops instead of looping.

## Interfaces
- HTTP: `GET /api/integrations/{servicenow|jira}/status[?verify=1]`, `POST .../preview`, `POST .../sync` (`server.mjs:78-83`). Body: ServiceNow `{ assignmentGroup, states[], priorities[], tag, updatedSinceHours, limit, startTriage }`; Jira `{ project, jql, updatedSinceHours, limit }`.
- Data: ticket `source`, `sourceKey`, `externalReference`, `metadata.serviceNow|jira`, status in `status`.
- UI: Sync dialogs in the Tickets page menu, disabled until `status.ready`.

## Non-functional constraints
- Basic auth with stored credentials; secrets never returned. Instance hosts are normalised and non-loopback hosts forced to HTTPS (`normalizeOrigin`, `schemeForHost`).
- A sync of N items does N store round trips; limit is capped at 2000.

## Known gaps / deviations
- `startTriage` is accepted by the ServiceNow filters, echoed in the response and exposed as a toggle in the dialog, but nothing starts a task; triage only comes from the poller with `auto_create_tasks` (SPEC-tickets-03).
- `jira-service.mjs` header says "Read-only Jira Cloud client" but the class now writes (comments, fields, assignment, transitions).
- ServiceNow "Resolved" maps to `closed`, so a ticket resolved upstream shows closed, not resolved, and `resolutionSummary` is not imported.
- Every sync overwrites imported fields (title, description, priority, status, category, tags) from the source, so any local change that was not written through is lost on the next poll.
- `getIncident` loads 100 incidents and filters client-side, so it fails for incidents outside the first page.
- `assignmentGroups` is always empty, so the dialog cannot offer groups from the live instance.
- Tests cover Jira pagination and transition choice, vanished-ticket closing and query building; none cover field mapping, the write-through bodies, preview, status or the admin gate.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/connectors/servicenow/servicenow-service.mjs:141-150`, `backend/src/connectors/jira/jira-service.mjs:73-78`, `backend/src/app/operations-service.mjs:420-427` | none |
| FR-2 | `backend/src/connectors/servicenow/servicenow-service.mjs:98-109`, `:152-175` | `backend/tests/ticket-sync.test.mjs:41` |
| FR-3 | `backend/src/connectors/servicenow/servicenow-service.mjs:25-33`, `:62-95` | none |
| FR-4 | `backend/src/connectors/jira/jira-service.mjs:88-117` | `backend/tests/jira-search.test.mjs:30`, `:40`, `:55`, `:61`, `:70` |
| FR-5 | `backend/src/connectors/jira/jira-service.mjs:8-11`, `:42-60` | none |
| FR-6 | `backend/src/app/operations-service.mjs:372-382`, `:433-440`, `backend/src/app/operations-store.mts:18-25` | `backend/tests/ticket-sync.test.mjs:16` |
| FR-7 | `backend/src/app/operations-service.mjs:390-418` | `backend/tests/ticket-sync.test.mjs:16` |
| FR-8 | `backend/src/app/operations-service.mjs:367-371`, `:428-432` | none |
| FR-9 | `backend/src/app/operations-service.mjs:486-515`, `backend/src/connectors/servicenow/servicenow-service.mjs:182-200`, `backend/src/connectors/jira/jira-service.mjs:132-170` | none |
| FR-10 | `backend/src/connectors/jira/jira-service.mjs:27-34`, `:138-151` | `backend/tests/jira-transition.test.mjs:25-64` |
| FR-11 | `backend/src/connectors/servicenow/servicenow-service.mjs:167`, `backend/src/connectors/jira/jira-service.mjs:104`, `:125` | none |

## Open questions
- Should ServiceNow Resolved import as `resolved` rather than `closed`?
