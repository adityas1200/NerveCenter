---
id: SPEC-automations-01
title: Automations - Sonic investigates failed, late and missed pipelines and failed data-quality checks
status: implemented        # approved by Mitesh 2026-10-06 (plan go-ahead); implemented 2026-10-06
area: automations
owners: []
credits: Detector rules (event keys, grace, missed-slot enumeration, cooldown, concurrency and daily caps) come from nagajas' SPEC-pipelines-07 draft, which this spec absorbs (decision D1).
code:
  - backend/src/monitoring/automation-settings.mjs
  - backend/src/monitoring/detector.mjs
  - backend/src/monitoring/alert-service.mjs
  - backend/src/monitoring/alert-prompts.mjs
  - backend/src/monitoring/monitoring-service.mjs
  - backend/src/monitoring/monitor-store.mjs
  - backend/src/api/monitoring-routes.mjs
  - backend/src/tasks/task-runtime.mjs
  - backend/src/tasks/ticket-tasks.mjs
  - frontend/src/features/settings/AutomationsTab.tsx
  - frontend/src/features/monitor/MonitorPage.tsx
  - frontend/src/features/data-quality/DataQualityPage.tsx
  - frontend/src/features/tasks/TasksPage.tsx
last_verified: 2026-10-06
---

# Automations

## Purpose
When a pipeline fails, runs late, never starts, or misses a scheduled run, or a data-quality check fails, something should
happen without anyone watching. A ticket is opened, Sonic investigates, or both, and the ticket is kept up to date. How this
client handles each kind of problem lives in its own knowledge (playbooks). Sonic reads them, checks them against the evidence
and goes beyond them where the evidence leads. Serves operations leads who want a first diagnosis waiting before anyone looks.

## Scope
- **In scope:**
  - Three triggers: `pipelineFailed`, `pipelineLate` and `dqFailed`.
  - The per-project settings, the detector, alerts (grouping, dedupe, reopen, recovery) and the responders (ticket, task, both).
  - Limits, the task type `alert`, the prompt contract, and the pages that show alerts and their tasks.
- **Out of scope:**
  - Applying fixes. The task's permission and Policy decide that (SPEC-tasks-03).
  - Fetching runs and results (SPEC-platform-10, ADR-0002).
  - Creating tickets in ServiceNow and Jira, and what is written on them (SPEC-tickets-07).

## Definitions
- **Slot**: one scheduled start time, taken from the pipeline's Quartz cron in its timezone.
- **Grace**: minutes after a slot within which a start is on time. A one-minute tolerance applies on both sides.
- **Occurrence**: one fact worth acting on, with a stable key:
  - `failed:<platform>:<pipelineId>:<runId>`
  - `late:<platform>:<pipelineId>:<slotISO>`
  - `long:<platform>:<pipelineId>:<runId>`
  - `dq:<resultKey>`
- **Alert**: the record that groups the occurrences of one problem. It is keyed by subject:
  - `pipeline:<platform>:<id>:failed`
  - `pipeline:<platform>:<id>:late`
  - `dq:<tableId>:<dataset>`
- **Armed**: the moment a trigger was switched on for a project.

## Actors and permissions
- **Project owners** (`project.settings`) and app admins change automations. A save is stamped with who and when.
- **Project members** read the automation, its fetch status and the alerts.
- **Resolving an alert** by hand needs `tickets.manage`.
- **The detector** is a system actor. Investigations act for the person who last saved the automation (`updatedBy`), so `ownerHold` applies: a blocked person or a viewer holds the work. With no saver (the legacy rule), they act for the system.

## Requirements

### Settings
- **FR-1** A project's automation SHALL be stored in `operations.yaml` under `automation`:
  - `enabled` (default true).
  - Per trigger: `{ action, permission, playbook, ticket? }`, plus the trigger's own fields.
  - `ticket` defaults: `{ platform: auto, priority: auto, assignmentGroup, projectKey, issueType: Task, onRecovery: comment }`.
  - `limits`: `{ maxConcurrent: 3, maxPerDay: 50, cooldownMinutes: 30, reopenHours: 24 }`.
  - `overrides.pipelines.<id>.{pipelineFailed,pipelineLate}` and `overrides.tables.<tableId>.dqFailed`.

  Missing fields SHALL take the defaults. An override SHALL win over the project setting for its one pipeline or table. `enabled: false` SHALL turn every trigger off.
- **FR-2** `action` SHALL be one of `off`, `ticket`, `task` or `task_and_ticket`. With `off`, an occurrence SHALL NOT be claimed, so switching the trigger on later still sees it, within the catch-up of FR-11.
- **FR-3** A save with an unknown key, an unknown value or a number out of bounds SHALL be refused with HTTP 400 and a sentence naming the field (for example `automation.pipelineLate.graceMinutes must be a whole number from 1 to 240`). The same check SHALL run when `operations.yaml` is validated.
- **FR-4** Only project owners and app admins SHALL save `automation` (`PUT /api/settings/automation`, `project.settings`). The server SHALL stamp `updatedBy` and `updatedAt`.
- **FR-5** A project that never saved `automation` SHALL keep the earlier behaviour: `pipelineFailed: ticket` for Databricks pipelines only, and every other trigger off. It is marked `legacy` (decision D4).

### Detection
- **FR-6** `pipelineFailed` SHALL produce one occurrence per run that ended in a failed state (SPEC-pipelines-02) in the last 24 hours. `pipelineLate` SHALL judge each slot of a schedulable, unpaused pipeline as one of:
  - `ran`: a start within the grace.
  - `late`: a start after the grace, before the next slot. This is a `late_start` occurrence.
  - `overdue`: the newest slot, past the grace, with nothing started. This is a `not_started` occurrence.
  - `missed`: an older slot that never got a run.
  - `pending`: still inside the grace.

  Paused and unparseable schedules SHALL produce no slots.
- **FR-7** No `pipelineLate` occurrence SHALL be raised for a slot while its grace (default 15 minutes) has not passed, or for a run that started inside it.
- **FR-8** A slot with no run SHALL be missed even when later slots ran. Each missed slot SHALL be its own occurrence of the one late alert. Slots before the first run on record SHALL NOT be judged, unless the trigger was already armed then.
- **FR-9** Slots SHALL come from the schedule in its own timezone, oldest first, bounded to 500 per pass, over `lookbackHours` (default 24).
- **FR-10** A slot whose run failed SHALL be a failure, never also late.
- **FR-11** An occurrence older than the moment its trigger was armed, less a 60-minute catch-up, SHALL be treated as history and not acted on. Switching a trigger off SHALL disarm it.
- **FR-24** `dqFailed` SHALL produce one occurrence per result in the last 24 hours that is:
  - `failed` (or `warning` when `includeWarnings`),
  - at or above `minSeverity` (default `high`),
  - and in one of `tables` (empty means every enabled table).
- **FR-25** Failed checks SHALL be grouped into one alert per result table and dataset.
- **FR-26** With `longRunning` on (default off), a latest run still running for more than `longRunningFactor` (default 2) times the typical duration SHALL be a `long_running` occurrence of the late alert.

### Alerts and responders
- **FR-12** Each occurrence SHALL be claimed once, ever, in the store before anything acts on it. If handling then fails, the claims SHALL be released so the next pass tries again.
- **FR-13** A new occurrence with no open alert of its key SHALL open an alert and run its action:
  - `ticket`: open the ticket.
  - `task`: start an investigation.
  - `task_and_ticket`: open the ticket, then investigate on it.

  A task that does not start SHALL leave the alert open, with the reason recorded.
- **FR-14** When `maxConcurrent` investigations are already queued or running in the project, a new one SHALL queue. Queued ones SHALL start oldest first as slots free up. One that has waited more than six hours SHALL be dropped, with the reason recorded.
- **FR-15** Past `maxPerDay` investigations started in the project since 00:00 UTC, further alerts SHALL be recorded but not investigated, with the reason recorded.
- **FR-16** An alert on an asset that was investigated in the last `cooldownMinutes` SHALL NOT be investigated, with the reason recorded. A reopened alert is exempt.
- **FR-17** An investigation without a ticket SHALL be a task of type `alert` with `context.alert` (alert id, trigger, subject, the latest 20 occurrences) and `notify: true`. Its permission SHALL be `read-only` unless the trigger's `permission` is `policy` (decision D3).
- **FR-18** An investigation on a ticket SHALL be that ticket's one task (`ensureTask`, SPEC-tasks-02), titled after the alert and carrying the same `context.alert`.
- **FR-19** The first message SHALL:
  - state the facts: the trigger, the subject, the occurrences and the permission;
  - name the method: the plugin's `rca` and `monitoring` skills;
  - say how to find the playbook: the pinned `playbook` page, or else a knowledge search for the trigger's playbook (for example `playbooks/pipeline-failed.md`) and for the asset.
- **FR-20** The message SHALL ask Sonic to:
  - follow the playbook steps that apply, check each against the evidence, and reason beyond it;
  - reason from the method alone when there is no playbook;
  - finish with the cause, the evidence, the proposed fix and the approval it needs, its confidence and the next check, and the playbook used, where it deviated and why;
  - propose any knowledge update, which goes through review as knowledge drafts always do.
- **FR-21** Alert details in the task's context SHALL be marked untrusted. They come from platform data.
- **FR-27** Alerts SHALL be persisted with their occurrences (the latest 200), the occurrence count, the action, the investigation (status, task, reason, start times) and the ticket. At most one alert per key SHALL be open.
- **FR-28** While an alert is open, new occurrences SHALL be appended to it. They SHALL be noted on its task and its ticket, without starting another turn.
- **FR-29** An open alert SHALL resolve by itself when its subject recovers, judged after the pass's new occurrences are recorded:
  - a failure alert, on a healthy run that started after the last failure;
  - a late alert, on an on-time slot after the last late one, or on its long run finishing;
  - a DQ alert, when every failing check has passed since.
- **FR-30** An occurrence within `reopenHours` of its alert resolving SHALL reopen the same alert. Its investigation SHALL continue in the same task with a new message. After that window, a new alert SHALL be opened, linked to the previous one.
- **FR-31** On recovery, the ticket SHALL get a note (`onRecovery: comment`), a note and resolution (`resolve`), or nothing (`none`).
- **FR-32** A ticket in NerveCenter for a failure SHALL be the run's own ticket, one per failed run as before. An existing one SHALL be used and never rewritten. Other alerts, and a run already tracked in another project, SHALL get a plain ticket (`source: nervecenter-alert`), linked to its pipeline.
- **FR-33** `priority: auto` SHALL give:
  - `high` for failures;
  - `medium` for late runs;
  - for checks, the highest severity among the occurrences.
- **FR-34** An alert's ticket SHALL be opened once. A platform that refuses SHALL be recorded on the alert and retried by later passes, up to five attempts.
- **FR-35** `ticket.platform` SHALL be one of:
  - `auto`: the project's first connected ServiceNow or Jira ticket source, else NerveCenter;
  - `nervecenter`, `servicenow` or `jira`.

  An external platform that is not connected SHALL fall back to NerveCenter, and the alert records why.
- **FR-36** When an investigation finishes, its outcome SHALL go back on the alert. Its findings SHALL go on an external ticket once per finish (SPEC-tickets-07).

### API and pages
- **FR-37** `GET /api/automation` SHALL return the project's effective automation (`config`) and its fetch status (`status`) to any member.
- **FR-38** `GET /api/alerts?status&trigger&subjectId&taskId&limit&offset` SHALL return `{ items, total }`, newest first, for the scope's projects. `limit` defaults to 25, at most 200.
- **FR-39** `POST /api/alerts/:id/resolve` (`tickets.manage`) SHALL resolve an open alert, noting it on its task. A second call SHALL answer 409, and an unknown id 404.
- **FR-40** Settings SHALL have an Automations tab for owners. It SHALL show:
  - the switch;
  - each trigger's action, permission, playbook and own fields;
  - ticket destination and fields;
  - limits;
  - exceptions per pipeline and per result table;
  - the fetch status;
  - who last changed it.

  A legacy project SHALL be told that saving replaces the earlier rule.
- **FR-41** The Pipelines page SHALL count, per pipeline, missed and late slots over the detector's lookback.
  - The Missed tile and filter SHALL include a pipeline with any missed slot, even after a later success.
  - A row with an open alert SHALL link to its task.
  - The detail sheet SHALL list missed and late starts, each with its task, and show a Task column in the run history.
- **FR-42** The Data Quality page SHALL link a result to the task that investigated it. The Tasks page SHALL have an Alerts type, and SHALL show "Automation · <trigger>" as the starter of an automatic investigation.

## Scenarios
### S1 Failure investigated
- **Given** `pipelineFailed: task`
- **When** run r1 of job 42 fails
- **Then** one alert opens, a read-only `alert` task starts, and the run's Task column links to it. A second pass does nothing.

### S2 Inside the grace
- **Given** a 06:15 daily slot with a 5-minute grace
- **When** it is 06:19 and nothing has started
- **Then** there is no event. At 06:21 there is one `not_started` event.

### S3 Late but within grace
- **Given** the same slot
- **When** the run starts at 06:18
- **Then** there is no event.

### S4 Missed earlier slot
- **Given** a 30-minute schedule
- **When** the 07:00 slot has no run but 07:30 ran
- **Then** 07:00 is missed and counted on the page.

### S5 Outage
- **When** eight slots in a row are missed
- **Then** there is one alert with eight occurrences and one investigation.

### S6 Storm
- **Given** `maxConcurrent: 1`
- **When** two pipelines fail
- **Then** the second waits, starts when the first finishes, and is dropped after six hours.

### S7 Recovery and return
- **Given** `onRecovery: resolve`
- **When** a healthy run follows a failure
- **Then** the alert resolves and the ticket gets a note and is resolved.
- **When** the job fails again within 24 hours
- **Then** the same alert reopens and the same task gets a new message.

### S8 Legacy project
- **Given** no `automation` section
- **When** a Databricks run fails
- **Then** exactly one NerveCenter ticket opens for that run and no task starts.

## Interfaces
- **HTTP:**
  - `GET /api/automation`, returns `{ config, status }`.
  - `GET /api/alerts`.
  - `POST /api/alerts/:id/resolve`.
  - `PUT /api/settings/automation` (owner).
- **Data:**
  - `operations.yaml` `automation`.
  - `ops_alerts`, `ops_alert_occurrences` and `ops_monitor_state` (`armed`, `pipelines:slots`) (ADR-0002).
- **Task:** `type: alert`, `context.alert`.
- **UI:**
  - `/settings?tab=automations`.
  - Pipelines (tile, row link, detail sheet).
  - Data Quality (Task link).
  - Tasks (Alerts tab).

## Non-functional constraints
- The detector is pure and unit-tested. One pass per project runs at most every minute, or right after a fetch.
- Model spend is bounded by the caps, the cooldown, grouping, and every trigger being off by default.

## Known gaps / deviations
- Quartz `L`, `W` and `#` schedules are unparseable, so they never raise late events.
- A missed slot is inferred from the cron. Neither platform records a schedule that did not fire.
- The DQ result-table setup is one shared instance, so its alerts are kept under PILOT.
- Overrides in Settings set only the action. Other fields can be set in `operations.yaml`.
- Cooldown compares by subject id across alerts of the same subject type.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2, FR-5 | `backend/src/monitoring/automation-settings.mjs` | `backend/tests/automation-settings.test.mjs`, `backend/tests/alert-service.test.mjs` |
| FR-3 | `automation-settings.mjs` `validateAutomation`, `workspace.mjs` `setSection` | `automation-settings.test.mjs`, `automation-api.test.mjs` |
| FR-4, FR-37..FR-39 | `backend/src/api/server.mjs`, `monitoring-routes.mjs` | `backend/tests/automation-api.test.mjs` |
| FR-6..FR-11, FR-24..FR-26 | `backend/src/monitoring/detector.mjs`, `pipeline-health.mjs` `scheduledSlots` | `backend/tests/monitoring-detector.test.mjs` |
| FR-12..FR-18, FR-27..FR-36 | `backend/src/monitoring/alert-service.mjs` | `backend/tests/alert-service.test.mjs`, `monitoring-service.test.mjs` |
| FR-19..FR-21 | `alert-prompts.mjs`, `task-runtime.mjs` `#turnContext` | `alert-service.test.mjs` (prompt carries the run) |
| FR-40 | `frontend/src/features/settings/AutomationsTab.tsx` | `frontend/src/features/settings/AutomationsTab.test.tsx` |
| FR-41 | `operations-service.mjs` `monitor`, `pipelineRunHistory`; `MonitorPage.tsx` | `monitoring-service.test.mjs`, `frontend/src/features/monitor/MonitorPage.automation.test.tsx` |
| FR-42 | `data-quality-service.mjs` `reconcile`; `DataQualityPage.tsx`; `TasksPage.tsx`; `api/tasks.ts` | `monitoring-service.test.mjs` (DQ), `frontend/src/api/tasks.alert.test.ts` |

## Open questions
- Should a bulk exception (every pipeline matching a name) exist, as SPEC-pipelines-07 FR-22 proposed?

## Manual refresh amendment (approved 2026-10-13)

Browser polling, focus/reconnect refetch and live task streaming are superseded by [Manual browser refresh](../platform/manual-refresh.md). Navigation, selection changes, explicit Refresh and affected user writes load data. Server jobs and APIs remain available.
