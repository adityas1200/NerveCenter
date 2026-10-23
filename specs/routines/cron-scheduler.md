---
id: SPEC-routines-01
title: Cron parsing and routine scheduler tick
status: implemented
area: routines
owners: []
code:
  - backend/src/routines/cron.mjs
  - backend/src/routines/routine-scheduler.mjs
  - backend/src/index.mjs
last_verified: 2026-10-03
---

# Cron parsing and routine scheduler tick

## Purpose
Routines are agent work that runs on a schedule. A small in-process scheduler fires each enabled scheduled routine once when its five-field cron expression matches the current minute in the routine's timezone. Serves operators who want recurring work (morning ticket review, weekly report) without an external scheduler.

## Scope
- In scope: cron syntax, timezone matching, next-run calculation, schedule sentences, form-to-cron, the 30 s tick, de-duplication per minute, workspace default timezone.
- Out of scope: routine CRUD/run/test/check (SPEC-routines-02), what the run task does (task runtime).
- Non-goals: seconds, `@daily` aliases, catch-up of missed runs, multi-instance locking.

## Actors and permissions
The scheduler is a system actor: runs it starts have no `user` (task `createdBy` becomes `system`). Production scheduled starts are dispatched durably unless env `OPS_ROUTINES=0` (SPEC-routines-03 supersedes FR-8 through FR-11).

## Requirements
- **FR-1** The system SHALL accept exactly five whitespace-separated cron fields (minute hour day month weekday) and reject any other count with "A cron expression needs five fields".
- **FR-2** Each field SHALL support `*`, `?`, lists (`,`), ranges (`a-b`), steps (`/n`), and three-letter names for months and weekdays; weekday `7` SHALL equal Sunday (0). Out-of-range values, backwards ranges and non-integer steps SHALL be rejected with a descriptive error.
- **FR-3** A cron SHALL match a date when all five fields match the wall-clock minute, hour, day, month and weekday of that instant in the routine's IANA timezone (UTC when empty); an unknown timezone SHALL raise "Unknown timezone". Day-of-month and weekday are ANDed.
- **FR-4** `nextRun` SHALL return the first matching minute strictly after `from`, scanning at most 400 days, else `null`.
- **FR-5** `describeCron` SHALL produce a sentence for the common shapes (every day, every weekday, one or several weekdays, day N of month, every N hours, every N minutes) and otherwise return the raw expression; it SHALL return the raw text for unparseable input.
- **FR-6** `cronFromSchedule` SHALL build a cron from `kind` weekday|daily|weekly|monthly|hours with `time` HH:MM (validated 00:00-23:59), clamping dayOfMonth to 1-31 and everyHours to 1-23; unknown kind SHALL throw.
- **FR-7** A routine without its own `trigger.timezone` SHALL use `operations.yaml` `team.timezone`, falling back to UTC when empty or invalid.
- **FR-8** The system SHALL enqueue every enabled, valid due routine slot through the durable dispatcher (SPEC-routines-03 FR-1/FR-2).
- **FR-9** A routine SHALL NOT create duplicate scheduled Tasks for the same project/name/epoch-minute slot (SPEC-routines-03 FR-4).
- **FR-10** Scheduled-job failures SHALL be logged and SHALL NOT stop processing other projects or routines.
- **FR-11** The old per-process routine timer SHALL not be started; `OPS_ROUTINES=0` disables durable routine scheduling.

## Scenarios
### S1 Weekday 09:00 IST fires once
- **Given** routine `0 9 * * 1-5` in `Asia/Kolkata`, clock Fri 03:30:10Z
- **When** `tick()` runs twice in that minute, then at 03:31:10Z
- **Then** one task `{routine, taskId}` is returned the first time; `[]` the other two times.

### S2 Paused routine does not fire
- **Given** the routine is paused (`app.enabled: false`) and the clock hits its minute
- **When** `tick()` runs
- **Then** nothing fires and `nextRunAt` is `null`.

### S3 Timezone fallback
- **Given** no `trigger.timezone` and empty `team.timezone`
- **When** the routine is saved
- **Then** timezone is `UTC`; after `team.timezone: Asia/Kolkata` is set, new routines (and handwritten files without a zone) are read in Kolkata.

### S4 Bad cron
- **Given** `schedule.cron = "nope"`
- **When** saving
- **Then** error matches "five fields"; a hand-edited file with a bad expression is shown with status `error` and never fires.

## Interfaces
- Config: env `OPS_ROUTINES` (`0` disables), `OPS_PLUGIN_DIR` not used; `team.timezone` in `operations.yaml`.
- Data: routine YAML `trigger: {type: schedule|manual, timezone, expression}` in `workspace/workflows/<name>.yaml`; scheduler state `RUNTIME_DIR/routines-state.json` -> `routines.<name>.{lastFiredAt,lastTaskId,lastFiredMinute}`.
- Task created per fire: type `routine`, `context.routine.fired = "schedule"`.

## Non-functional constraints
- Matching uses `Intl.DateTimeFormat` per candidate minute; `nextRun` worst case is 576 000 evaluations per routine per list call.
- State file is a single JSON read-modify-write without locking; assumes one backend instance.

## Known gaps / deviations
- Catch-up is bounded to the preceding seven days; older slots are not recovered (SPEC-routines-03 FR-6).
- Day-of-month and weekday are ANDed, unlike Vixie cron (OR when both restricted); "1st and Mondays" cannot be expressed.
- DST: a local time that does not exist or repeats is skipped or fires once per wall-clock match; not specified or tested.
- A scheduled fire does not check whether the previous run is still running; runs can overlap.
- `list()` computes `nextRun` for every routine on every request (see Non-functional).
- `lastFiredMinute` is written only after `startTask` succeeds, so a crash between start and write can double-fire.
- Only a single, happy-path tick test exists; cron edge cases (names, steps like `5/10`, weekday 7) have partial coverage in `cron:` test only.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/routines/cron.mjs:40` | `backend/tests/routines.test.mjs:18` |
| FR-2 | `cron.mjs:14-38` | `routines.test.mjs:18` |
| FR-3 | `cron.mjs:47-59` | `routines.test.mjs:18` |
| FR-4 | `cron.mjs:62` | `routines.test.mjs:18` |
| FR-5 | `cron.mjs:73` | `routines.test.mjs:18` |
| FR-6 | `cron.mjs:94` | `routines.test.mjs:18` |
| FR-7 | `routine-scheduler.mjs:34` | `routines.test.mjs:87` |
| FR-8 | `routine-scheduler.mjs:148-150` | `routines.test.mjs:38` |
| FR-9 | `routine-scheduler.mjs:118,151` | `routines.test.mjs:38` (same process only) |
| FR-10 | `routine-scheduler.mjs:141,152` | none |
| FR-11 | `routine-scheduler.mjs:136-137`, `backend/src/index.mjs:28,31` | none |

## Open questions
- Should missed runs be caught up (with a window) after downtime?
