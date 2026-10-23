---
id: SPEC-platform-12
title: Durable scheduled execution
status: implemented
area: platform
owners: []
code:
  - backend/src/jobs/job-store.mjs
  - backend/src/jobs/scheduler.mjs
  - backend/src/jobs/github-jobs.mjs
  - backend/src/jobs/knowledge-jobs.mjs
  - backend/migrations/012-scheduled-jobs.sql
last_verified: 2026-10-12
---

# Durable scheduled execution

## Purpose

Record due background work before executing it, so two server processes do not perform the same scheduled operation and a restart can recover eligible work. ADR 0011 defines the queue choice and retry boundary.

## Requirements

- **FR-1** Enqueuing a project, source and schedule slot SHALL create at most one job for that key, including across two Postgres writers. The job SHALL record due time, state and a bounded attempt history.
- **FR-2** A worker SHALL atomically claim at most one due job; another worker SHALL NOT claim the same job while its lease is valid. Completion, failure and renewal SHALL require the current lease token.
- **FR-3** An expired claim SHALL be recoverable. Read-only provider fetches and idempotent imports MAY retry up to three attempts with bounded backoff; a job that can start a Sonic turn or perform an ambiguous external write SHALL NOT replay automatically after an uncertain attempt.
- **FR-4** At most one scheduled provider job per project SHALL be active at a time. Jobs for different projects MAY run concurrently.
- **FR-5** Local file mode SHALL record equivalent job states and unique keys for one process. Postgres multi-worker claims SHALL use the existing migration chain; file mode SHALL use its migration twin.
- **FR-6** Completed and failed run history SHALL be retained for a bounded period and removed in bounded batches. Queries SHALL be bounded and ordered.
- **FR-7** Moving a timer family to the dispatcher SHALL stop that family's old timer in the same release. A manual Refresh now SHALL keep its permission checks and synchronous API response.
- **FR-8** After downtime, at most the latest missed cron slot of each routine SHALL be enqueued; older missed slots SHALL be recorded as skipped. Sonic execution remains subject to a separate ownership decision.

## Critical checks

Two Postgres workers race for one due key, a worker loses its lease before completion, retry and terminal state after crashes, file-mode parity, and restart recovery. Each migrated timer family gets a focused test proving one scheduled execution and its manual path.

## Known gaps

The current deployment retains one authoritative backend for Sonic sessions and workspace files under ADR 0013. Cross-instance UI event delivery remains deferred under ADR 0014; the current change feed serves the approved one-backend deployment.
