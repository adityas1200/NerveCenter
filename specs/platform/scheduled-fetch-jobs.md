---
id: SPEC-platform-14
title: Durable ticket and monitoring fetch schedules
status: implemented
area: platform
owners: []
code:
  - backend/src/jobs/
  - backend/src/main.mts
  - backend/src/tasks/ticket-tasks.mjs
  - backend/src/monitoring/monitoring-service.mjs
  - backend/src/api/monitoring-routes.mjs
last_verified: 2026-10-12
---

# Durable ticket and monitoring fetch schedules

## Purpose

Use the shared scheduled-job dispatcher for ticket imports and monitoring provider fetches, so work due during process downtime can be recovered and concurrent schedulers do not repeat the same fetch. Preserve current per-project cadence and manual operations.

## Scope

- In scope: ServiceNow/Jira scheduled imports; pipeline and Data Quality scheduled provider fetches; detector and automatic-triage separation; manual ticket poll and monitoring refresh compatibility.
- Out of scope: workspace synchronization; Sonic session ownership; changing provider clients or import filters; changing automation policy or user permissions.

## Actors and permissions

Scheduled work uses the existing system scope and workspace/project connections. Manual endpoints retain their current authentication and permissions: ticket poll is admin-only; monitoring refresh is available to an authorized project member.

## Requirements

- **FR-1** Ticket imports SHALL be enqueued through the existing `ScheduledJobDispatcher`, independently for every active normal project, using the project's `sync.tickets` cadence, else shared sync cadence, else the existing ticket server default. The dispatcher SHALL persist due slots and deduplicate concurrent submissions through the existing job store.
- **FR-2** Ticket import jobs SHALL invoke only ServiceNow/Jira import operations. They MAY retry idempotent import work up to three attempts with the dispatcher's bounded backoff. A failing source SHALL NOT prevent another configured source or project from being processed.
- **FR-3** Automatic ticket triage SHALL remain separate from retryable import execution. An operation that may call `ensureTask()`/`startTask()` or send a Sonic message SHALL NOT be automatically retried after an uncertain attempt. Provider-import retries SHALL never include or replay such an operation. Under ADR 0017, a stable project/ticket Task key SHALL relink a created Task after a crash instead of starting a duplicate.
- **FR-4** Pipeline and Data Quality provider fetches SHALL be scheduled through the existing dispatcher, independently for each project's configured cadence and existing sync/active-app gates. Shared Data Quality results SHALL be fetched once under the `ledgerProjectId` identity, as required by SPEC-platform-10 FR-9.
- **FR-5** A retryable monitoring job SHALL perform provider fetch and ledger writes only. Detection, alert handling, alert draining, task starts, and Sonic follow-ups SHALL run outside that retryable operation and only after successful data fetch, on the existing detector cadence.
- **FR-6** Migrating each provider-fetch timer SHALL disable that timer in the same release. Any retained local timer SHALL be limited to detector or triage work and SHALL NOT poll providers.
- **FR-7** `POST /api/tickets/poll` SHALL remain admin-only, force the configured imports regardless of auto-sync/app-active gates, and preserve its current response shape and synchronous behavior.
- **FR-8** `POST /api/monitor/refresh` SHALL retain current authorization, 30-second throttle, and synchronous `{ result, status }` response. The handler SHALL wait for the requested queued fetch and the corresponding detection work before responding.
- **FR-9** Workspace synchronization SHALL remain on its current host-local timer. This spec does not authorize multiple backend owners for workspace files or Sonic sessions.

## Scenarios

### S1 Project-specific import due times

- **Given** two projects with different ticket cadences
- **When** the dispatcher checks due work
- **Then** it enqueues only each project's due source slots and a restart does not reset those slots.

### S2 Sonic start uncertainty

- **Given** an import succeeds and a triage start has an uncertain outcome
- **When** a worker recovers or retries provider work
- **Then** the ticket import may be retried within its bound, but the uncertain Sonic start is not replayed by that retry.

### S3 Shared Data Quality ledger

- **Given** multiple projects share the configured Data Quality result tables
- **When** monitoring jobs are scheduled
- **Then** one fetch is scheduled under the ledger-owning project, while pipeline jobs retain their own project identities.

### S4 Manual contracts

- **Given** an authorized caller invokes either manual endpoint
- **When** the operation completes (or monitoring refresh is throttled)
- **Then** the existing response shape, permissions, synchronous completion, and 429 behavior are preserved.

## Interfaces

- HTTP: unchanged `POST /api/tickets/poll`; unchanged `POST /api/monitor/refresh` request and response.
- Data: existing `ops_scheduled_jobs` store and file-mode twin; ADR 0017 adds migration 014 and a file-mode twin for the automatic-triage Task key.
- Configuration: existing `sync.tickets`, `sync.pipelines`, `sync.dataQuality`, `sync.enabled`, presence gate, and `OPS_*` controls.

## Non-functional constraints

Use the existing lease, bounded retry, retention, and project concurrency behavior in SPEC-platform-12. Keep per-project provider connections and access scopes. Do not place Sonic starts, messages, or other ambiguous writes inside an automatically retried job. Keep provider work bounded by current service limits.

## Known gaps / deviations

Scheduled ticket imports and monitoring fetches run in retryable jobs. Automatic triage and monitoring detection use local cadences, separate from provider fetches. Manual ticket polling retains its synchronous path, and manual monitoring refresh waits for queued fetch results. One backend remains the authoritative workspace and Sonic owner; live provider-call and freshness measurements remain a deployment check.

## Traceability

| Requirement | Code | Test |
|---|---|---|
| FR-1..FR-3 | `ticket-tasks.mjs`, new ticket job source | New scheduled ticket job tests; existing `tasks.test.mjs` |
| FR-4..FR-6 | `monitoring-service.mjs`, new monitoring job source, `main.mts` | New scheduled monitoring job tests; existing `monitoring-service.test.mjs` |
| FR-7 | ticket poll route and `ticket-tasks.mjs` | `api.test.mjs` and ticket poll route coverage |
| FR-8 | monitoring route and `monitoring-service.mjs` | `automation-api.test.mjs`, `monitoring-service.test.mjs` |
| FR-9 | `main.mts`, workspace sync startup | startup-focused coverage |

## Implementation decisions

Manual ticket polling waits for imports and triage as it does today. Scheduled provider jobs are retryable only while they import. Automatic triage stays on a local, non-provider cadence and uses ADR 0017's durable per-ticket Task key to relink after a restart without replaying a claimed Sonic turn.
