---
id: SPEC-routines-03
title: Durable scheduled routine starts
status: implemented
area: routines
owners: []
code:
  - backend/src/routines/routine-scheduler.mjs
  - backend/src/jobs/routine-jobs.mjs
  - backend/src/tasks/task-store.mts
  - backend/src/tasks/task-runtime.mts
  - backend/src/main.mts
  - backend/migrations/013-routine-task-slot.sql
last_verified: 2026-10-12
---

# Durable scheduled routine starts

## Purpose

Queue cron due slots before starting Sonic, with a bounded restart policy. This spec supersedes only SPEC-routines-01 FR-8 through FR-11 and its no-catch-up non-goal after implementation; cron parsing and manual routine behavior remain there and in SPEC-routines-02.

## Requirements

- **FR-1** Each enabled valid routine SHALL have an independent cron due slot keyed by project, routine name and epoch minute. A repeated scheduler pass SHALL NOT enqueue the same slot twice.
- **FR-2** After downtime, the scheduler SHALL enqueue at most the latest missed slot per routine and record older due slots as skipped. The dispatcher SHALL claim and create only one catch-up Task per project at a time; TaskRuntime’s existing concurrency cap governs Sonic execution.
- **FR-3** A queued job SHALL recheck that its project and routine are active, valid and authorized before starting a Task; otherwise it SHALL record a skip without starting Sonic.
- **FR-4** Each scheduled job key SHALL create at most one Task in file or Postgres mode, including when a worker stops after Task creation and before job completion. A claimed scheduled job with an uncertain outcome SHALL NOT automatically replay a Sonic turn.
- **FR-5** Manual Run and Test SHALL retain their current permission, Task and HTTP response behavior. The old routine timer SHALL stop when the queued source is registered.
- **FR-6** Catch-up discovery SHALL be bounded to the preceding seven days, matching scheduled-job retention; older slots outside that window are not recovered.

## Critical checks

Two worker attempts for the same scheduled slot, catch-up with two missed routines, crash after Task creation, a paused routine, and manual Run and Test.

## Known gaps

An uncertain claimed routine job needs operator review; external provider writes cannot be guaranteed exactly once without provider idempotency.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/jobs/routine-jobs.mjs`, `backend/src/routines/routine-scheduler.mjs` | `backend/tests/routine-jobs.test.mjs` |
| FR-2 | `routine-jobs.mjs`, `routine-scheduler.mjs` | `routine-jobs.test.mjs` |
| FR-3 | `routine-scheduler.mjs` | `routine-jobs.test.mjs` |
| FR-4 | `backend/src/tasks/task-store.mts`, `task-runtime.mts`, migration 013 | `routine-task-store.test.mjs` |
| FR-5 | `routine-scheduler.mjs`, `backend/src/main.mts` | `routine-jobs.test.mjs` |
| FR-6 | `routine-scheduler.mjs` | `routine-jobs.test.mjs` |
