---
id: SPEC-tickets-07
title: Tickets NerveCenter opens in ServiceNow and Jira, and keeps up to date
status: implemented        # approved by Mitesh 2026-10-06 (plan go-ahead); implemented 2026-10-06
area: tickets
owners: []
code:
  - backend/src/connectors/servicenow/servicenow-service.mjs
  - backend/src/connectors/jira/jira-service.mjs
  - backend/src/app/operations-service.mjs
  - backend/src/monitoring/alert-service.mjs
  - backend/src/monitoring/alert-prompts.mjs
  - backend/src/sync/integration-sync.mjs
  - backend/src/bootstrap.mjs
last_verified: 2026-10-06
---

# Tickets NerveCenter opens and updates

## Purpose
When an automation's action includes a ticket (SPEC-automations-01), the app opens it in the client's ticketing platform. It
does so deterministically and once, whatever the agent's permission. It then keeps the ticket current: investigating, it
happened again, the findings, recovered.

## Scope
- **In scope:**
  - Creating a ServiceNow incident or a Jira issue.
  - Idempotency.
  - Tracking it as a NerveCenter ticket.
  - The notes and resolution the app writes.
  - Retiring the separate Databricks failure-ticket job.
- **Out of scope:**
  - Changes Sonic makes itself, which go through Policy (SPEC-tasks-03).
  - Importing tickets (SPEC-tickets-03).

## Actors and permissions
The automation writes as a system actor, "Sonic via NerveCenter". There is no route; nothing outside the alert service calls it.

## Requirements
- **FR-1** ServiceNow: `POST /api/now/table/incident` SHALL be sent with display values: short description, description, priority, assignment group, and `correlation_id` set to the alert id. Jira: `POST /rest/api/3/issue` SHALL be sent with the project key (the setting, else the connection's), the issue type, the summary, an ADF description and the label `nc-<alertId>`. A project that refuses the priority field SHALL get the issue without one.
- **FR-2** The created incident or issue SHALL be tracked as a NerveCenter ticket in the project. It SHALL be created by the automation, carry its priority, the alert and pipeline ids, and an activity line naming its number.
- **FR-3** Before creating, the app SHALL look for the alert's correlation id (ServiceNow) or label (Jira). A ticket already tracked SHALL be returned, so a retry never opens a second one.
- **FR-4** With an investigation, the task SHALL be the ticket's task, and the ticket SHALL get a "started investigating" note naming the task.
- **FR-5** Notes the app writes SHALL go on the ticket's timeline and into the source, as a ServiceNow work note or a Jira comment, signed as the automation. A source that refuses SHALL leave the note on the timeline, marked as not saved there. A configured platform that is not connected SHALL fall back to a NerveCenter ticket, and the alert says why.
- **FR-6** On recovery with `onRecovery: resolve`, the ticket SHALL be resolved in the source first, then here, with the recovery as its resolution. A ticket already closed SHALL be left alone.
- **FR-7** The integration sync SHALL no longer open a ticket per failed Databricks run. `pipelineFailed: ticket` does that now, and it is the default for projects that never saved an automation (SPEC-automations-01 FR-5). This retires SPEC-tickets-06 FR-4.

## Scenarios
### S1 Crash between create and link
- **When** the app opened INC001 and stopped before linking it
- **Then** the retry finds INC001 by its correlation id and links it. No second incident is opened.

### S2 Jira without priority
- **Given** a Jira project whose create screen has no priority field
- **Then** the issue is created on the second attempt, without priority.

## Known gaps / deviations
- ServiceNow notes are always work notes. Customer-visible comments are not offered.
- Ticket field mapping beyond priority, assignment group, project key and issue type is not configurable.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `servicenow-service.mjs` `createIncident`, `findByCorrelation`; `jira-service.mjs` `createIssue`, `findByLabel` | `backend/tests/source-tickets.test.mjs` |
| FR-2, FR-3 | `operations-service.mjs` `createSourceTicket` | `source-tickets.test.mjs` |
| FR-4 | `alert-service.mjs` `#start`, `#ensureTicket` | `backend/tests/alert-service.test.mjs` |
| FR-5 | `operations-service.mjs` `systemNote`; `alert-service.mjs` `#ticketPlatform` | `source-tickets.test.mjs`, `alert-service.test.mjs` |
| FR-6 | `operations-service.mjs` `systemResolve`; `alert-service.mjs` `resolve` | `source-tickets.test.mjs`, `alert-service.test.mjs` |
| FR-7 | `integration-sync.mjs` (`databricksFailures`), `bootstrap.mjs` | `backend/tests/monitoring-service.test.mjs` (D4) |
