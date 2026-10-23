# 0015. Give each scheduled routine slot one task

- Status: accepted (2026-10-12, user approved)
- Date: 2026-10-12
- Related: ADR 0011, ADR 0013, SPEC-platform-12, SPEC-routines-01

## Context

The accepted queue deduplicates a scheduled job, but a worker can stop after creating its Sonic task and before acknowledging the job. A retry could create a second task. The current routine timer records `lastFiredMinute` only after task creation and misses a slot while the server is down. SPEC-routines-01 documents no catch-up, while accepted ADR 0011 and SPEC-platform-12 FR-8 require bounded catch-up.

## Decision

Move scheduled routine starts to the existing job dispatcher and stop the routine timer in `main.mts`. Keep manual Run and Test synchronous on their current API. Use one job key per project, routine name and epoch-minute cron slot (encoded in the queue slot as `<routine>:<epoch-minute>`). On restart, enqueue only the latest missed slot **per routine**, record older due slots as skipped, and cap catch-up job claims/task creation at one per project at a time; TaskRuntime retains its existing execution concurrency cap. Catch-up discovery is bounded to seven days; each routine's latest job slot, legacy `lastFiredMinute`, and `app.updated_at` bound subsequent discovery. A paused, deleted, invalid or no-longer-authorized routine is skipped before starting a task.

Persist the scheduled job key on its Task. Add a forward-only Postgres unique index over the project and scheduled key in task JSON, and use the file store's existing exclusive write lock for an equivalent check/create operation. A retry finds and returns the already-created Task. Keep scheduled routine jobs at one attempt after a worker has claimed them; an uncertain crash leaves a visible failed job for review and never replays a possibly started Sonic turn. Existing routine state remains a display summary and is updated from the Task after creation.

## Alternatives considered

- Queue key alone: prevents duplicate jobs, but not a duplicate Task across a crash between task creation and job completion.
- Scan existing Tasks before creation: two workers can both scan and then create.
- Automatically retry every claimed routine: can repeat a Sonic provider write after an uncertain crash.

## Consequences

A new task-store operation and migration are needed for file and Postgres parity. Existing Tasks without a scheduled key stay valid. The current cron parser and routine Run behavior remain. Tests must cover two-worker claims, restart catch-up per routine, duplicate task prevention after a simulated crash, and manual Run. Rollback can return to the previous timer while leaving the forward-only index unused.
