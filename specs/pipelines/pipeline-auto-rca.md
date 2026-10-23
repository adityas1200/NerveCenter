---
id: SPEC-pipelines-07
title: Pipeline auto-RCA (read-only root-cause analysis on failed, delayed and missed runs)
status: deprecated        # superseded 2026-10-06 by SPEC-automations-01 (specs/automations/auto-investigation.md), which keeps this draft's detector rules and credits them (decision D1)
area: pipelines
owners: []
code:
  - backend/src/platform/pipeline-health.mjs
  - backend/src/platform/pipeline-rca-monitor.mjs
  - backend/src/platform/pipeline-rca-settings.mjs
  - backend/src/tasks/task-runtime.mjs
  - frontend/src/features/settings/PipelineRcaSettings.tsx
last_verified: 2026-10-06
---

# Pipeline auto-RCA

## Purpose
When a monitored pipeline fails, starts late, or skips a scheduled slot, the agent (Sonic) starts a read-only root-cause analysis on its own, reads the run logs and related data, and writes down the likely cause and a proposed fix. It never changes a system and never opens a ticket. Serves data-quality and operations owners who want a first diagnosis waiting before anyone looks.

## Scope
- In scope: three triggers (failed, delayed, missed slot), per-pipeline configuration, the detector that evaluates them, the read-only task it starts, de-duplication, cost limits, the Settings UI and its API.
- Out of scope: applying fixes, opening or updating tickets (SPEC-tickets-03), notifications beyond the task's own `notify` flag, fetching runs (SPEC-pipelines-01), the existing health verdict (SPEC-pipelines-02, extended only by FR-9).

## Definitions
- **Monitored pipeline**: a pipeline with an auto-RCA config whose `enabled` is true.
- **Slot**: one scheduled fire time derived from the pipeline's cron and timezone.
- **Grace**: minutes after a slot during which a late start is still acceptable (the warehouse may be busy).
- **Event key**: the identity of a trigger occurrence, used to run each occurrence at most once. `failed` → `<pipelineId>:failed:<runId>`; `delayed` → `<pipelineId>:delayed:<slotISO>`; `missed` → `<pipelineId>:missed:<slotISO>`.

## Actors and permissions
- Detector: system actor, acts for the config's `createdBy` user (as routines do), so that user's role caps what the task may do; for these tasks the cap is always `read-only`.
- Settings: users with `routines.manage` (developer, admin) may view and edit; viewers may view. Enforced server-side (not the UI-only check routines have today, see SPEC-routines-02 Known gaps).
- A user who is blocked or a viewer as owner SHALL park the work exactly as `ownerHold` does for routines (no task, reason recorded).

## Requirements

### Configuration
- **FR-1** Auto-RCA config SHALL be stored per pipeline in `operations.yaml` under `pipelineRca.pipelines.<pipelineId>` as `{ enabled, onFailed: {enabled}, onDelayed: {enabled, graceMinutes}, onMissed: {enabled, lookbackHours}, createdBy, updatedAt }`, with workspace defaults in `pipelineRca.defaults` of the same shape. A pipeline without its own entry SHALL inherit the defaults; with no defaults, every trigger is off.
- **FR-2** Defaults SHALL be: `enabled: false`, all three triggers disabled, `graceMinutes: 5`, `lookbackHours: 24`. Nothing is monitored until someone turns it on.
- **FR-3** Validation: `graceMinutes` an integer 1-240; `lookbackHours` an integer 1-168; unknown keys rejected; a trigger can only be enabled when the pipeline's schedule parses (delayed and missed need a schedule; failed does not). Violations SHALL fail with HTTP 400 and the field named.
- **FR-4** A global kill switch `pipelineRca.enabled` (default true) SHALL stop all auto-RCA when false, without losing per-pipeline settings.

### Detection
- **FR-5** A detector SHALL run on a timer (default every 60 s, configurable via `OPS_PIPELINE_RCA_POLL_SECONDS`), one pass per active project, a failure in one project never stopping another. It SHALL reuse the pipeline and run data the monitor already fetches rather than adding its own platform calls.
- **FR-6** **Failed.** When a monitored pipeline's latest run is in a failed state (SPEC-pipelines-02 FR-2) and `onFailed` is enabled, the detector SHALL start an RCA for that `runId`. A later failed run of the same pipeline is a new event.
- **FR-7** **Delayed.** When `onDelayed` is enabled and `pipelineHealth` returns `overdue` using `graceMs = graceMinutes * 60_000`, the detector SHALL start an RCA for that `dueAt` slot. No RCA SHALL start before `slot + graceMinutes`. If a run for the slot starts during the grace, no event occurs.
- **FR-8** **Missed.** When `onMissed` is enabled, the detector SHALL check each slot in `[now - lookbackHours, now - graceMinutes]` and raise an event for every slot that has no run starting within `[slot, slot + graceMinutes + 1 minute]`, even if later slots succeeded (slot 7:00 with no run, run at 7:30 succeeded, so 7:00 is missed). Slots before the first run the platform has on record SHALL NOT be called missed (cannot be judged). A pipeline with fewer than 3 consecutive missed slots in one pass SHALL get one task per slot; 3 or more SHALL be collapsed into one task listing all slots.
- **FR-9** To support FR-8, the schedule module SHALL expose `scheduledSlots(parsed, timezone, fromMs, toMs)` returning slot times in order (bounded by the existing 20,000-step budget), and `pipelineHealth` behaviour SHALL NOT change.
- **FR-10** **Overlap between triggers.** A slot that is both delayed and missed SHALL raise one event only. Precedence: `failed` (run exists) > `delayed` (still inside the lookback's newest slot) > `missed` (older slot). Only the highest-precedence enabled trigger starts a task.
- **FR-11** Paused pipelines (SPEC-pipelines-02 FR-1) SHALL never trigger delayed or missed; they MAY still trigger failed for a run that failed before the pause if it was not yet analysed.

### De-duplication and limits
- **FR-12** Each event key SHALL start at most one task, ever. Keys SHALL be persisted (`pipeline-rca-state.json` or the equivalent Postgres table) so a restart or a second app instance never repeats an RCA. The key SHALL be written before the task starts and rolled back if the task fails to start.
- **FR-13** A pipeline SHALL have a cooldown (default 30 minutes, `pipelineRca.cooldownMinutes`) between RCA tasks across event types; events inside the cooldown are recorded as `suppressed: cooldown` and not retried.
- **FR-14** At most `pipelineRca.maxConcurrent` (default 3) RCA tasks SHALL run at once; further events wait in a queue and start as slots free, oldest first. Events older than 6 hours when dequeued are dropped as `suppressed: stale`.
- **FR-15** A daily cap per project, `pipelineRca.maxPerDay` (default 50), SHALL stop new RCA tasks and record `suppressed: daily-cap`; a warning SHALL be logged once per day.

### The RCA task
- **FR-16** The task SHALL be `{ type: 'pipeline-rca', permission: 'read-only', notify: true }`. `read-only` SHALL be set by the detector and SHALL NOT be configurable or overridable by the config or by a follow-up message made by the system. A person MAY widen it from the task afterwards, as with triage tasks.
- **FR-17** The prompt SHALL state the trigger (failed / delayed / missed), the pipeline, platform, run id or slot(s), schedule and timezone, the recent run history, and instruct: read the run output and logs, check upstream and downstream data with `query_data` (read-only SELECT), compare with the typical duration and previous successful runs, and finish with (1) one-line likely cause, (2) evidence, (3) a proposed fix and what approval it would need, (4) confidence and the next check if unsure. It SHALL say "do not change any system" and "nobody is waiting to answer".
- **FR-18** The task `context.pipelineRca` SHALL carry `{ pipelineId, platform, trigger, eventKey, runId|slots, firedAt }` so the Pipelines page and Tasks can link to it.
- **FR-19** No ticket SHALL be created or modified by this feature. If a ticket already exists for the same run, it is left alone.
- **FR-20** If the task cannot read the logs (permissions, platform down), it SHALL still finish with what it could determine and say what it could not read.

### UI and API
- **FR-21** `GET /api/pipeline-rca` returns the global switch, defaults and per-pipeline effective config; `PUT /api/pipeline-rca/defaults` and `PUT /api/pipeline-rca/pipelines/:id` save; `DELETE /api/pipeline-rca/pipelines/:id` resets to defaults; `GET /api/pipeline-rca/events?pipelineId=` lists recent events with `{eventKey, trigger, status: started|suppressed:<reason>, taskId, at}`.
- **FR-22** Settings SHALL show a "Monitoring and auto-RCA" section: global switch, defaults, and a pipeline table (search, filter by platform) where each row has the on/off switch and three trigger toggles, with grace minutes and lookback hours inline where relevant, plus a bulk "apply to selected". Triggers needing a schedule are disabled with the reason on schedule-less pipelines.
- **FR-23** The Pipelines page SHALL show a small "Auto-RCA" chip on monitored pipelines and a link to the latest RCA task on a failed/overdue row.

## Scenarios
### S1 Failure
- **Given** `onFailed` enabled, latest run `failed` with id R1
- **When** the detector passes
- **Then** one read-only `pipeline-rca` task starts with `eventKey` `<id>:failed:R1`; the next pass starts none.

### S2 Delayed, inside grace
- **Given** slot 06:15, `graceMinutes: 5`, now 06:19, no run
- **Then** no task. At 06:21 one `delayed` task starts for slot 06:15.

### S3 Delayed, starts during grace
- **Given** the run starts at 06:18
- **Then** no event.

### S4 Missed slot, later success
- **Given** every 30 min, 7:00 has no run, 7:30 ran and succeeded, now 7:45, `onMissed` enabled, lookback 24 h
- **Then** one `missed` task for slot 07:00, none for 07:30.

### S5 Many missed slots
- **Given** the schedule was broken overnight and 8 slots have no run
- **Then** one task listing all 8 slots, not 8 tasks.

### S6 Restart
- **Given** an RCA was started for an event key, then the app restarts
- **Then** no second task for that key.

### S7 Limits
- **Given** 5 pipelines fail in the same pass, `maxConcurrent: 3`
- **Then** 3 start, 2 are queued and start as earlier ones finish.

### S8 Read-only holds
- **Given** the agent decides a fix is needed
- **Then** write tools are denied and it describes the change instead.

### S9 Off by default
- **Given** a new workspace
- **Then** no auto-RCA runs for any pipeline until enabled.

## Interfaces
- Module: `pipeline-rca-monitor.mjs` exposes `PipelineRcaMonitor { start, stop, tick }` and `evaluate({ pipeline, runs, config, now, state })` returning events (pure, unit-testable); `pipeline-rca-settings.mjs` reads/validates/writes the config in `operations.yaml`.
- HTTP: see FR-21. Server enforces `routines.manage` for writes.
- Tasks: `type: pipeline-rca`, visible in Tasks with `context.pipelineRca`.
- Env: `OPS_PIPELINE_RCA_POLL_SECONDS` (default 60).

## Non-functional constraints
- Detector adds no platform calls beyond the monitor's own refresh; evaluation is bounded (slot enumeration capped per pipeline).
- Cost is bounded by FR-13 to FR-15; each task SHALL record cost like any task.
- The detector SHALL be idempotent: running a pass twice at the same instant starts nothing new.
- Event state SHALL survive restarts and be shared across instances (Postgres where configured).

## Known gaps / deviations
- Run data is only as fresh as the monitor's refresh; a failure can be detected up to one poll interval late.
- Quartz `L/W/#` schedules are unknown (SPEC-pipelines-02 FR-4), so delayed and missed never fire for them; failed still works.
- Missed detection depends on the platform keeping run history for the lookback window.
- No per-pipeline notification routing; results are the task and its `notify` behaviour.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1..FR-4 | `pipeline-rca-settings.mjs` | planned: `backend/tests/pipeline-rca-settings.test.mjs` |
| FR-5..FR-11 | `pipeline-rca-monitor.mjs` `evaluate`, `pipeline-health.mjs` `scheduledSlots` | planned: `backend/tests/pipeline-rca-monitor.test.mjs` |
| FR-12..FR-15 | `pipeline-rca-monitor.mjs` | planned: same |
| FR-16..FR-20 | `pipeline-rca-monitor.mjs`, `task-runtime.mjs` | planned: same |
| FR-21 | `backend/src/api/` route file | planned: `backend/tests/pipeline-rca-routes.test.mjs` |
| FR-22, FR-23 | `PipelineRcaSettings.tsx`, Pipelines page | planned: `PipelineRcaSettings.test.tsx` |

## Open questions
- Where should results go besides the task: the existing inbox, email, or Teams?
- Should auto-RCA default to off for all pipelines (as written) or on for failed only?
- Should a ticket be linked when one already exists for the same run, or stay fully separate (as written)?
- Should the missed-slot collapse threshold (3) be configurable?
