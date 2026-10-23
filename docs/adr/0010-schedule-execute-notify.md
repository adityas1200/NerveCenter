# 0010. Separate scheduling, execution, and UI notification

- Status: accepted (2026-10-11, user approved phased implementation)
- Date: 2026-10-11
- Related: CR-23, ADR 0002, ADR 0007, `specs/platform/fetch-cadence.md`, `specs/routines/cron-scheduler.md`, `specs/tasks/task-runtime.md`

## Context

Five server timers, several page polls, and the in-memory task queue each decide when or where work runs. The Data Quality page has two 60-second refresh triggers. Monitoring fetch state is persisted, but most timer and execution guards are process-local. The backend currently requires one process per workspace. Task SSE only broadcasts events from its own process. The [audit](../code-review/polling-scheduling-audit.md) records the frequencies and their costs.

## Decision

Use three distinct responsibilities. A scheduler evaluates each project's configured cadence or routine cron slot and submits a uniquely keyed due job. A durable Postgres execution queue claims and runs each job with bounded concurrency, retry policy, and recoverable state; manual Refresh now submits the same work with its existing permissions and API response. Provider fetches retain their current implementations and project scope. The local file-store mode runs one scheduler/worker and records equivalent job state without promising multi-process ownership.

The UI receives project-authorized, resource-keyed change hints over SSE and invalidates the relevant TanStack Query keys. Keep the existing task stream for task output. Use visible-page polling as a bounded recovery path if the change stream is disconnected. The Data Quality page has one visible 60-second refresh trigger and one read after it completes; its full-window mirror policy and manual refresh remain. Deploy the phases separately and disable the timer each job replaces when its durable path is active.

Phase 3 must compare a small queue built with existing `pg` against maintained Postgres queue libraries before choosing an implementation. [Graphile Worker](https://worker.graphile.org/docs) and [pg-boss](https://pgboss.io/introduction) both offer Postgres-backed jobs, retries, and scheduling; their schema ownership, cron semantics, Node compatibility, operational cost, and fit with file-store mode require a separate decision. No Redis, Kafka, or new service is approved by this ADR.

## Alternatives considered

- Keep independent timers and add only frontend caching: leaves primary-project coupling and cross-instance duplicate execution.
- Replace all timers with system cron: loses per-project configuration and does not solve execution claims or UI delivery.
- Stream provider data directly to every page: repeats provider calls per viewer and bypasses the monitoring ledger.

## Consequences

Scheduled work gets an auditable project/job/slot identity, and all viewers can read the same stored result. New storage needs forward-only migrations and file-store parity. The scheduler must define missed-slot catch-up and ambiguous Sonic write recovery before task migration. Cross-instance SSE needs durable replay or another gap-free handoff. Existing APIs, permissions, provider adapters, routine definitions, and refresh buttons remain stable. Each phase can be reverted independently; unused forward-only queue tables may remain after rollback.
