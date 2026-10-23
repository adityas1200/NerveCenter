---
id: SPEC-tickets-05
title: Tickets page (list, filters, quick view, create, sync dialogs)
status: implemented
area: tickets
owners: []
code:
  - frontend/src/features/tickets/TicketsPage.tsx
  - frontend/src/features/tickets/TicketDetailSheet.tsx
  - frontend/src/features/tickets/TicketDialogs.tsx
  - frontend/src/features/tickets/ticketFields.ts
  - frontend/src/api/tickets.ts
last_verified: 2026-10-11
---

# Tickets page

## Purpose
One table of every ticket from ServiceNow, Jira, pipelines, checks and manual entry with the same four statuses, filters that Overview tiles can deep-link into, and a side sheet where a person reads the agent's finding and acts (assign, comment, edit, resolve, reopen, investigate).

## Scope
- In scope: routes `/tickets` and `/tickets/:ticketId`, list, filters, stat strip, quick view, New ticket dialog, Sync from ServiceNow/Jira dialogs.
- Out of scope: backend behaviour (SPEC-tickets-01..04), the agent panel and task page.

## Actors and permissions
All roles see the page. Buttons follow `ticket.permissions.canComment` and `canClose`; Assign, Reassign, Edit and Resolve are always shown to anyone who opens a ticket (the server decides). Sync menu items are enabled when the integration `ready`, but the sync call itself is admin-only.

## Requirements
- **FR-1** The page SHALL request a bounded page from `GET /api/tickets` with `limit`, `offset`, scope, filters, search and sort, and refetch while visible. The server SHALL apply caller access before computing full-scope stat counts and filter options, then filter, search and sort before returning the page and exact filtered total. A ticket outside the current page SHALL remain reachable; no fixed 5,000-row cap may hide it.
- **FR-2** Scope tabs SHALL be Open (all non-closed, regardless of period), Closed (closed within the page's time range, by `closedAt`, else `updatedAt`, else `createdAt`) and All (open plus closed-in-range). The default is Open; `?scope=closed|all` selects the others.
- **FR-3** URL query params SHALL drive filters: dropdowns `priority`, `status` (app status), `assignee` (supports `__none`), `source`, each accepting a comma list; link-only params `resolved=sonic|dobby` (agent-fixed only), `kind`, `category` (`data_quality` also matches check-sourced tickets); `q` free-text search over id, source number, title, description, pipeline name, failure summary and assignee name; `range`. "Clear N" SHALL remove all but scope and range.
- **FR-4** The table SHALL show Priority, Ticket (source number else id), Title, Source (logo and label), Assignee ("No owner" if none), Status pill (app status with source status as detail), Updated, and per-row "Assign to me" (for open unowned tickets) and "Ask Sonic". Default sort priority ascending; priority, title, source, assignee, status (waiting_on_you, open, in_progress, closed) and updated are sortable. Row click opens `/tickets/:id` keeping the query string.
- **FR-5** The stat strip SHALL show Open tickets, High priority open (critical+high), "Sonic needs you" (open with `waiting_on_you`) and "Fixed with Sonic" (closed in range with `resolvedWithAgent`, "of N closed"), each linking to the matching filter.
- **FR-6** When the list is empty and neither ServiceNow nor Jira reports `configured`, the page SHALL show "No ticket source connected" with a link to Connectors.
- **FR-7** "Assign to me" SHALL PATCH the signed-in user as assignee, refresh tickets and overview, and toast "Assigned to you" (errors: "Could not assign").
- **FR-8** The quick view SHALL load detail and activity, refetch detail every 5 s while `agent.state === 'working'`, and show: priority and app-status pills, number, source and requester, agent block, facts (assignee, requester, group or category, source state, priority, last update, pipeline run, resolution), description, link to the source record, actions, and activity list.
- **FR-9** Actions SHALL be: Assign to me (open, unowned), Reassign (open, owned), Comment (unless `canComment === false`), Edit (title, description, priority), Resolve (optional resolution note, PATCH status `resolved`), Reopen (closed, unless `canClose === false`, PATCH status `open`), and "File in ServiceNow" (tickets with no ServiceNow/Jira source, sends an agent prompt via Investigate). Successful saves toast with "saved in <System> <number>" when `sourceWrite` is present; failures toast "Not saved" with the server message.
- **FR-10** Investigate SHALL call `POST /api/tickets/:id/investigate` with `permission: 'policy'` and navigate to `/tasks/<taskId>`; "Look again" after done or failed sends a follow-up prompt.
- **FR-11** New ticket SHALL require a non-blank title and send title, description, category (Something is broken, Access request, Data question, Change request, Task), priority, assignee (me, a known person, or unassigned) and `startTriage`; on success it navigates to the new ticket.
- **FR-12** Sync dialogs SHALL preview (ServiceNow: group, states, priorities, tag, updated-since, limit default 10; Jira: project key, JQL, since, limit default 25; limit clamped 1..2000), show total, already-imported and a sample, disable Import until `ready` and a non-zero total, and on import toast "<N> imported or refreshed" and refresh tickets.

## Scenarios
### S1 Overview tile lands on a filtered list
- **When** the URL is `/tickets?priority=critical,high` **Then** only critical and high tickets show and the filter chips and "Clear" count reflect it.
### S2 Closed scope is windowed
- **Given** a ticket closed 40 days ago and range 7 days **Then** it is absent from Closed and All.
### S3 Claim and comment
- **When** a user clicks "Assign to me" then comments in the quick view **Then** the row shows them as assignee and the activity list gains a comment.
### S4 No source
- **Given** no tickets and unconfigured integrations **Then** the empty state points to Connectors; with a configured source it says "No open tickets".

## Interfaces
- Routes: `/tickets`, `/tickets/:ticketId`. API client: `ticketsApi` (`list, detail, create, update, comment, activity, investigate, serviceNow.{status,preview,sync}, jira.{status,preview,sync}`).
- UI states: `QueryState` loading/error, empty variants, toasts for every mutation.

## Non-functional constraints
- The list uses server paging (SPEC-platform-11); stat counts and filter options cover the full accessible scope, and the table total covers all filtered tickets.
- Accessible labels on search, scope tabs and filter selects; row actions have `aria-label`.

## Known gaps / deviations
- The ServiceNow dialog and New ticket dialog send `startTriage`, which the backend ignores (SPEC-tickets-04, SPEC-tickets-01); the toggles do nothing.
- Edit, Resolve, Reassign are shown without checking `canAssign`/`canClose`, so non-owners hit a 403 toast.
- Closed tickets with no timestamp fall back to `createdAt` for the period, which can hide old-but-recent closures.
- Tests cover import dialog, URL filters, sorting, empty states, claim, comment, create, and the closed-window rule; not covered: Edit, Resolve, Reopen, Investigate, Look again, Jira dialog, 30 s refetch.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `frontend/src/features/tickets/TicketsPage.tsx`, `backend/src/app/ticket-page.mts` | `frontend/src/features/tickets/TicketsPage.pagination.test.tsx`, `backend/tests/ticket-page.test.mjs`, `backend/tests/pagination-postgres.test.mjs` |
| FR-2 | `frontend/src/features/tickets/TicketsPage.tsx:132-135` | `frontend/src/features/tickets/TicketsPage.test.tsx:248` |
| FR-3 | `frontend/src/features/tickets/TicketsPage.tsx:41-65`, `:152-173` | `frontend/src/features/tickets/TicketsPage.test.tsx:147`, `:158`, `:180` |
| FR-4 | `frontend/src/features/tickets/TicketsPage.tsx:259-299` | `frontend/src/features/tickets/TicketsPage.test.tsx:191`, `:229` |
| FR-5 | `frontend/src/features/tickets/TicketsPage.tsx:205-210` | none |
| FR-6 | `frontend/src/features/tickets/TicketsPage.tsx:179-180`, `:231-237` | `frontend/src/features/tickets/TicketsPage.test.tsx:209`, `:222` |
| FR-7 | `frontend/src/features/tickets/TicketsPage.tsx:123-130` | `frontend/src/features/tickets/TicketsPage.test.tsx:257` |
| FR-8, FR-9, FR-10 | `frontend/src/features/tickets/TicketDetailSheet.tsx:44-160` | `frontend/src/features/tickets/TicketsPage.test.tsx:257` (comment only) |
| FR-11 | `frontend/src/features/tickets/TicketDialogs.tsx:21-95` | `frontend/src/features/tickets/TicketsPage.test.tsx:279` |
| FR-12 | `frontend/src/features/tickets/TicketDialogs.tsx:102-240` | `frontend/src/features/tickets/TicketsPage.test.tsx:93` (ServiceNow) |

## Open questions
- Should the UI hide actions the server will refuse?
