---
id: SPEC-routines-02
title: Routines (create, edit, run, test, pause, check)
status: implemented
area: routines
owners: []
code:
  - backend/src/routines/routine-scheduler.mjs
  - backend/src/api/routine-routes.mjs
  - backend/src/workspace/workspace.mjs
  - frontend/src/features/routines/RoutinesPage.tsx
  - frontend/src/features/routines/RoutineDetailPage.tsx
  - frontend/src/features/routines/RoutineDialog.tsx
  - frontend/src/features/routines/routineText.ts
last_verified: 2026-10-03
---

# Routines (create, edit, run, test, pause, check)

## Purpose
A routine is a saved instruction the agent (Sonic) carries out on a schedule or on demand. Each run is a Task of type `routine`, so results, approvals and cost show up in Tasks. Serves developers/operators who want repeatable work with a chosen autonomy level.

## Scope
- In scope: routine file format, list/get/save/pause/resume/delete, run now, test run, setup check, Routines list and detail UI.
- Out of scope: cron semantics and the tick (SPEC-routines-01), task execution and approvals.

## Actors and permissions
Server: any authenticated user may call all `/api/routines*` routes (not in `ADMIN_ROUTES`). UI: all roles see the pages; only admins get the "unrestricted" permission choice in the dialog (`allowUnrestricted`). See Known gaps.

## Requirements
- **FR-1** A routine SHALL be stored as `workspace/workflows/<slug>.yaml` with `name, objective, trigger, uses, authority, success, on_failure` plus an `app` block `{title, enabled, notify, connections, result: tasks, created_by, updated_at}`; the name SHALL be a lowercase slug of at most 64 chars.
- **FR-2** `save` SHALL require a name (from name, title or objective) and a non-empty objective, `permission` in `read-only|policy|ask|allow`, `notify` in `on_complete|on_failure|never`; otherwise it SHALL throw (HTTP 400).
- **FR-3** `save` SHALL map permission to `authority` (`read-only`->`writes: denied`, `allow`->`writes: allowed`, `policy`->`default_write: policy`, `ask`->`default_write: ask`) and the view SHALL map it back; unrecognised `writes` values SHALL read as `ask`.
- **FR-4** Saving over an existing routine SHALL keep `uses` (when already set), `success`, `on_failure`, `created_by`, and the paused/enabled state unless `enabled` is passed.
- **FR-5** A save without `schedule.cron` or `schedule.kind` SHALL create a `manual` trigger.
- **FR-6** The list/get view SHALL include `title, objective, trigger, permission, enabled, notify, connections, scheduleText, nextRunAt, scheduleError, lastFiredAt, status, lastRun, lastTest, recentRuns (10)`; `status` SHALL be `running` if a non-test run is queued/running, else `paused` if disabled, else `error` if the schedule is invalid or the YAML failed to load, else `scheduled`.
- **FR-7** Test tasks (`context.routine.test`) SHALL be excluded from `lastRun`/`recentRuns` and reported under `lastTest`.
- **FR-8** `run` SHALL start a Task `{type: routine, permission: routine's, notify: notify != never}` whose prompt contains the title, objective, the workflow file name and a request for a two-line summary; it SHALL record `lastFiredAt` and `lastTaskId`.
- **FR-9** A test run SHALL use permission `read-only`, `notify: false`, title suffix " · test run", and a prompt line demanding preview mode.
- **FR-10** `check` SHALL return `{ok, checks[]}` covering: schedule validity, each named connection present in `operations.yaml connections`, `team.name` and `team.timezone` set, and the plugin skill count; `ok` is true only if all pass.
- **FR-11** `PUT/PATCH` with a body whose only key is `enabled` SHALL toggle the flag; otherwise it SHALL perform a full save with the URL name.
- **FR-12** Delete SHALL remove the YAML file and return `{name, deleted}`; past runs stay in Tasks.
- **FR-13** A YAML file that fails to parse SHALL be listed with `error: "Invalid YAML: ..."` and status `error`, not crash the list.
- **FR-14** UI: the list SHALL show state dot, title, schedule words, next/last run, permission label and a Run button (disabled while running); rows open `/routines/<name>`; actions menu has Open, Pause/Resume, Open last run, Delete. The detail page SHALL offer Run now, Test run, Edit, Pause/Resume, Delete (with confirm) and a Setup check panel.
- **FR-15** UI schedule words SHALL be the backend `scheduleText` when it differs from the raw cron; otherwise cron is translated client-side.

## Scenarios
### S1 Create from form
- **Given** title "Daily ticket review", kind weekday 09:00 Asia/Kolkata, read-only, connections ["Jira"]
- **When** POST `/api/routines`
- **Then** 201, name `daily-ticket-review`, `scheduleText` "Every weekday at 9:00 AM (Asia/Kolkata)", connections `["jira"]`, file has `authority: writes: denied`.

### S2 Check flags missing connection
- **Given** routine uses `jira` but `operations.yaml` has none
- **When** POST `/api/routines/<name>/check`
- **Then** `ok:false` with `connection:jira` failed; after adding the connection and team settings `ok:true`.

### S3 Test run is not a run
- **When** POST `/test`
- **Then** 202 task titled "... · test run", `notify:false`, `lastTest` set, `recentRuns` unchanged.

### S4 Edit keeps paused
- **Given** paused routine; **When** full save with new cron/permission; **Then** `enabled` stays false.

## Interfaces
- `GET /api/routines` -> `{items}`; `POST /api/routines` -> 201 view; `GET|PUT|PATCH|DELETE /api/routines/:name`; `POST /:name/run` and `/test` -> 202 task; `POST /:name/pause|resume|check` -> 200. Unknown name on GET -> 404; elsewhere errors default to 400 (`run` on unknown -> 404 via statusCode).
- Data: `workflows/*.yaml`, `routines-state.json`; tasks of `type: routine` filtered by `context.routine.name` (latest 500 tasks).
- UI: `/routines`, `/routines/:name`; list refetches every 30 s, detail every 15 s; empty "No routines yet" / "No routines match".

## Non-functional constraints
- Agent tool `list_routines` (`backend/src/tasks/nervecenter-tools.mjs:222`) exposes the same view to the agent.
- Run history is derived from the newest 500 tasks only.

## Known gaps / deviations
- No server-side role check: a `viewer` can create, run, delete routines and set `permission: allow`. RBAC defines `routines.manage` (developer, admin) but nothing enforces it; the "unrestricted only for admin" rule exists only in the UI.
- `list_routines` agent tool reads `lastRun.id` but the summary field is `taskId`, so `taskId` is always undefined.
- `run`/`test` do not check `enabled` (paused routines can be run manually) and do not block concurrent runs; only the UI disables the button.
- `on_failure.retry`, `success` criteria, `uses` are stored but never enforced by the app; `check` "skills" row always passes.
- `uses` is kept from the old file while `app.connections` is replaced on edit, so they can diverge.
- Routine names that slug to empty or invalid fail with a generic 400; deleting does not clear `routines-state.json` entry.
- Detail page and dialog have no tests; only list rendering and text helpers are covered. Backend tests need the `quickSdk` stub, no API-route test exists.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/workspace/workspace.mjs:173-194`, `routine-scheduler.mjs:79-101` | `backend/tests/routines.test.mjs:38` |
| FR-2 | `routine-scheduler.mjs:80-83` | `routines.test.mjs:38` (cron error only) |
| FR-3 | `routine-scheduler.mjs:18-25` | `routines.test.mjs:38` |
| FR-4 | `routine-scheduler.mjs:91-97` | `routines.test.mjs:38` |
| FR-5 | `routine-scheduler.mjs:84` | none |
| FR-6 | `routine-scheduler.mjs:54-74` | `routines.test.mjs:38` |
| FR-7 | `routine-scheduler.mjs:63-64` | `routines.test.mjs:38` |
| FR-8 | `routine-scheduler.mjs:108-120` | `routines.test.mjs:38` |
| FR-9 | `routine-scheduler.mjs:114,117` | `routines.test.mjs:38` |
| FR-10 | `routine-scheduler.mjs:123-134` | `routines.test.mjs:38` |
| FR-11 | `backend/src/api/routine-routes.mjs:10` | none |
| FR-12 | `routine-routes.mjs:11`, `workspace.mjs:194` | `routines.test.mjs:38` |
| FR-13 | `workspace.mjs:180` | none |
| FR-14 | `frontend/src/features/routines/RoutinesPage.tsx`, `RoutineDetailPage.tsx` | `RoutinesPage.test.tsx:15` (list only) |
| FR-15 | `frontend/src/features/routines/routineText.ts:17` | `routineText.test.ts:4` |

## Open questions
- Should `routines.manage` be enforced server-side and should `allow` be admin-only?
