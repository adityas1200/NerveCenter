---
id: SPEC-pipelines-02
title: Pipeline health verdict, schedule parsing and typical duration
status: implemented
area: pipelines
owners: []
code:
  - backend/src/platform/pipeline-health.mjs
last_verified: 2026-10-03
---

# Pipeline health verdict, schedule parsing and typical duration

## Purpose
One rule for what a pipeline's state means to a business user: healthy, failed, or overdue (a scheduled run did not start), plus quiet states. Also yields the next scheduled start and the usual duration shown on the Pipelines page.

## Scope
- In scope: `pipelineHealth()`, `parseSchedule`, `toFiveFieldCron`, `previousFire`, `nextFire`, `typicalDuration`.
- Out of scope: fetching runs (SPEC-pipelines-01), cron grammar (`backend/src/routines/cron.mjs`).

## Actors and permissions
Pure function; no actor.

## Requirements
- **FR-1** `pipelineHealth` SHALL return `{health, nextRunAt, dueAt, typicalDurationMs}` with `health` in `paused|running|failed|overdue|no_runs|healthy|unknown`, evaluated in this precedence: paused schedule, latest run running, latest run failed, overdue, no runs, healthy/unknown.
- **FR-2** Status matching SHALL be case-insensitive with spaces/hyphens as `_`. Failed: `failed, failure, error, timedout, timed_out, canceled, cancelled, internal_error, upstream_failed`. Running: `running, queued, pending, in_progress, blocked, waiting_for_retry`. Healthy: `healthy, success, succeeded, successful, completed, complete`. Any other latest status with no overdue slot SHALL be `unknown`.
- **FR-3** A pipeline SHALL be `overdue` when its schedule parses, is not paused, the latest scheduled minute at or before `now - graceMs` (default 15 min) is not before `windowStart` (if given), and there is no run, or the latest run started more than 1 minute before that slot. `dueAt` SHALL carry that slot.
- **FR-4** Schedules SHALL be accepted as the Databricks object (`quartzCronExpression|cron|expression`, `timezoneId|timezone`, `pauseStatus`), `"<cron> · <tz>"` text, or bare cron. Quartz (6-7 fields) SHALL have seconds dropped, `?` widened to `*`, and weekdays shifted from 1-7 to 0-6. Expressions containing `L`, `W` or `#`, or with <5 or >7 fields, SHALL be unknown: never overdue, no next run.
- **FR-5** An unknown timezone SHALL fall back to UTC.
- **FR-6** `nextRunAt` SHALL be the first fire strictly after `now`, searched within 35 days / 20,000 steps; absent when paused or unparseable.
- **FR-7** `typicalDurationMs` SHALL be the median `durationMs` of earlier healthy runs (excluding the newest) and null with fewer than 3 samples.

## Scenarios
### S1 Missed nightly run
- **Given** cron `0 0 2 * * ?` UTC, now 02:30, latest run yesterday 02:00, healthy
- **Then** `overdue`, `dueAt` today 02:00.

### S2 Inside grace
- **Given** same schedule, now 02:10
- **Then** not overdue (`healthy`).

### S3 Paused
- **Given** `pauseStatus: PAUSED` and a failed latest run
- **Then** `paused`, `nextRunAt` null.

### S4 Quartz special
- **Given** `0 0 12 L * ?`
- **Then** never overdue, no next run.

### S5 Window start
- **Given** the due slot predates `windowStart`
- **Then** not overdue (cannot be judged).

## Interfaces
- Module API only (`pipelineHealth({schedule, runs, now, windowStart, graceMs})`); runs newest first with `status`, `startTime`, `durationMs`.
- Consumed by `OperationsService.monitor` (`operations-service.mjs:291`) and mirrored client-side by `healthOf` in `MonitorPage.tsx:64`.

## Non-functional constraints
- Intl formatters cached per timezone; bounded search loops (called thousands of times per refresh).
- DST: wall-clock matching via `Intl`; no explicit DST tests.

## Known gaps / deviations
- Frontend duplicates the verdict as a fallback (`healthOf`) with slightly different state sets (e.g. `timed out`, `late`).
- `unknown` is reported for statuses like `skipped`, `completed` is healthy but `status_not_reported` is unknown; no distinct "skipped" health.
- Quartz `L/W/#` and Quartz year field are unsupported silently.
- Overdue ignores that a run in progress from an earlier slot may exist (running wins first only when it is the latest).

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/platform/pipeline-health.mjs:144-168` | `backend/tests/pipeline-health.test.mjs:58` |
| FR-2 | `pipeline-health.mjs:20-22,123` | `pipeline-health.test.mjs:58` |
| FR-3 | `pipeline-health.mjs:156-163` | `pipeline-health.test.mjs:58` |
| FR-4 | `pipeline-health.mjs:46-81` | `pipeline-health.test.mjs:8,19` |
| FR-5 | `pipeline-health.mjs:40-43` | `pipeline-health.test.mjs:30` |
| FR-6 | `pipeline-health.mjs:105-121,150` | `pipeline-health.test.mjs:30` |
| FR-7 | `pipeline-health.mjs:128-133` | `pipeline-health.test.mjs:86` |

## Open questions
- Should `skipped` runs have their own verdict?

## Manual refresh amendment (approved 2026-10-13)

Browser polling, focus/reconnect refetch and live task streaming are superseded by [Manual browser refresh](../platform/manual-refresh.md). Navigation, selection changes, explicit Refresh and affected user writes load data. Server jobs and APIs remain available.
