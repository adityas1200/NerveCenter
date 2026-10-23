---
id: SPEC-tasks-01
title: Task runtime (lifecycle, events, streaming, sessions, edit and resume)
status: implemented
area: tasks
owners: []
code:
  - backend/src/tasks/task-runtime.mjs
  - backend/src/tasks/task-store.mts
  - backend/src/tasks/agent-model.mjs
  - backend/src/api/task-routes.mjs
last_verified: 2026-10-12
---

# Task runtime

## Purpose
Every unit of agent work (a chat, a ticket investigation, a routine run) is a Task: one Claude Agent SDK session that runs as the operations-fleet orchestrator inside the workspace. The runtime turns SDK messages into stored, ordered task events, pushes them live over SSE, gates writes, survives restarts and lets a person queue, edit, rewind or stop work.

## Scope
- In scope: `TaskRuntime` (start, message, queue, edit, cancel, delete, restart recovery, concurrency, cost), `FileTaskStore`/`PostgresTaskStore`, model/effort resolution, the `/api/tasks` HTTP surface and its SSE stream, task file serving.
- Out of scope: write gating rules (SPEC-tasks-03), the in-process tools (SPEC-tasks-04), Inbox UI (SPEC-tasks-05), ticket mirroring (SPEC-tasks-02), UI (SPEC-tasks-06/07).

## Actors and permissions
- Task and Inbox writes require their route permissions. Task reads require project access; raw task logs additionally require the app administrator's `logs.view` permission.
- System actor `{id:'system', name:'NerveCenter'}` is used for automatic messages and tasks with no user.
- Task `permission` is one of `read-only | policy | ask | allow`.

## Requirements
- **FR-1** `startTask` SHALL reject a `type` other than `ticket|routine|alert|adhoc` (`alert` added 2026-10-06 for automatic investigations, SPEC-automations-01 FR-17), a `permission` other than the four above, and an empty prompt; otherwise it SHALL create a task `T-<n>` (counter starts at 1001, Postgres sequence `ops_task_seq`) with status `queued`, defaults `permission='policy'`, `notify=true`, zeroed `cost`, `changes=0`, `sessionId=null`, create the task folder, and enqueue the prompt.
- **FR-2** The title SHALL default to the first non-empty prompt line, cut to 80 chars (77 + ellipsis), or `New task`.
- **FR-3** At most `maxConcurrent` tasks (env `OPS_MAX_CONCURRENT_TASKS`, default 3) SHALL run at once; further runs wait in `queuedRuns`; a task SHALL never have two runs at once.
- **FR-4** A run SHALL set status `running`, stamp `startedAt` once, record a `user.message` event (text = `display` or prompt, actor = sender or system), then stream the SDK query. A run on a `cancelled` task SHALL do nothing.
- **FR-5** SDK messages SHALL be stored as events: `session.init`, `assistant.text` (non-empty text blocks, max 20000 chars), `tool.use` (input kept as valid JSON, long string values cut at 8000), `tool.result` (max 20000), `result` (cost, usage, turns, duration, sessionId), `status`, `error`, `approval.*`, `question.*`. Events SHALL get a uuid `id`, ISO `at`, and a per-task gapless `seq` starting at 1.
- **FR-6** `stream_event` partials SHALL be emitted as `delta` (`text start|delta`, `tool start`, `block stop`) to live subscribers only and SHALL NOT be stored.
- **FR-7** On run end the runtime SHALL add `result` cost into `task.cost` (usd to 6 dp, input tokens incl. cache read/creation, output tokens, turns, durationMs, runs+1).
- **FR-8** On failure (thrown error or `is_error` result) the task SHALL become `failed` with `error` (max 4000), an `error` event, and, if `notify!==false`, a `bad` notification Inbox item.
- **FR-9** On success the task SHALL get `summary` (first plain line, max 160) and `report` (first prose paragraphs, max 700). For `adhoc` tasks status SHALL be `done`. For `ticket`/`routine` tasks whose reply ends with `?` the status SHALL be `waiting` and a `question` Inbox item SHALL be created; otherwise `done`.
- **FR-10** A `success` notification SHALL be created when `notify!==false` and the task is not `adhoc`, or is `adhoc` and ran longer than 45 s.
- **FR-11** If the saved `sessionId` fails with "no conversation found", the runtime SHALL drop the session, record a `Starting a new session` status event and retry exactly once as a new session.
- **FR-12** `sendMessage` SHALL reject empty text, unknown task (404), a `cancelled` task, and a task with `pendingApprovalId` (message differs for question vs approval). It MAY change `permission` and refresh `context.page`. It SHALL mark the task's pending `question` Inbox items `read`.
- **FR-13** `sendMessage` SHALL persist accepted follow-ups before returning HTTP 202. If the task is running, it SHALL return `{queued:true,message}` and run the live queue in order after the current turn. An acknowledged follow-up left unsent by a restart SHALL remain visible in `task.queue` and SHALL need explicit resend; restart SHALL NOT run it automatically.
- **FR-14** Queued messages SHALL be editable (`editQueued`), removable (`removeQueued`), or sendable now (`sendQueuedNow`); an unknown id SHALL give 404. Send-now on a running task SHALL cancel its pending approvals, record an `Interrupted` status event, abort the run and put the message first; on an idle task it SHALL just enqueue.
- **FR-15** `editMessage` SHALL accept only a non-system `user.message` event of that task (404 otherwise), and SHALL refuse (409) when any later event is an approved decision or a top-level `tool.use` whose category is not `read`/`task_files`.
- **FR-16** An accepted edit SHALL stop whatever runs or waits (queue cleared, pending approvals rejected, pending Inbox items `cancelled`, run aborted up to 5 s), delete all events with `seq >= target.seq`, reset the task to `queued` with `sessionId=null`, `pendingApprovalId=null`, cleared summary/report/error, increment `historyVersion`, retitle if it was the first message and the title still matched the old prompt, record a `Message edited` status event, and re-run with a prompt that carries the transcript of kept user/assistant text plus the new message (the thread shows only the new text).
- **FR-17** `cancel` SHALL drop queued runs and messages, reject and `cancel` pending approvals, abort the run, record `Cancelled`, and set status `cancelled` with `finishedAt`.
- **FR-18** `deleteTask` SHALL return 409 while the task is active, `queued` or `running`; otherwise it SHALL delete the task, its events, its Inbox items and its task folder.
- **FR-19** `setPermission` SHALL validate the value, record a `Permission changed to <x>` status event and apply to the next tool call even mid-run.
- **FR-20** `recoverAfterRestart` (run at boot unless `OPS_RECOVER_ON_BOOT=0`) SHALL run only a never-claimed initial command persisted with the task. It SHALL mark interrupted `running` and `waiting` turns `failed` with an error event, retaining prior events and Inbox items. It SHALL keep an open approval visible and mark it `detached`. It SHALL NOT replay a saved SDK session, last displayed message, approval write, or unsent follow-up. A person SHALL explicitly continue interrupted work after reviewing it (ADR 0013).
- **FR-21** Model and effort SHALL be resolved per run: `operations.yaml agent.model|effort` first, then `OPS_AGENT_MODEL`/`OPS_AGENT_EFFORT`, then `sonnet`/`high`; models are `opus|sonnet|haiku`, efforts `low|medium|high|xhigh|max`; haiku gets no effort.
- **FR-22** The SDK options SHALL load the plugin dir, `settingSources:['project']`, `cwd`=workspace, `permissionMode:'default'`, `includePartialMessages:true`, `maxTurns` = `OPS_MAX_TURNS_PER_RUN` (120), `persistSession:true`, and append the orchestrator prompt plus a per-task context (permission wording, ticket/routine/page context, report rules) to the `claude_code` preset.
- **FR-23** `GET /api/tasks/:id/events?after=<seq>` SHALL send stored events after `seq`, then a `task` snapshot, then live `event`, `delta` and `task` frames, with a `: keepalive` comment every 15 s; events with `seq <= lastSeq` SHALL NOT be re-sent.
- **FR-24** Task files under the task folder SHALL be served as a tree, `content`, and `raw`; raw is limited to 20 MB (413), sets `nosniff`, and HTML/SVG carry `Content-Security-Policy: sandbox`. `raw` is opened by the browser directly, so it takes the project as `?project=` as well as the header (SPEC-projects-01 FR-50).
- **FR-25** Task store listing SHALL sort by `updatedAt` desc, filter by `type`/`status` (`all` ignored), and clamp `limit` to 1..1000 (default 100).
- **FR-26** `GET /api/tasks/:id/logs` SHALL require `logs.view` in addition to project access; project developers and viewers SHALL receive 403.

## Scenarios
### S1 Write pauses and resumes
- **Given** a `permission:'ask'` task whose agent calls a write tool
- **When** the gate runs
- **Then** an `approval` Inbox item and an `approval.requested` event exist, the task is `waiting` with `pendingApprovalId`; approving sets `running`, records `approval.decided`, and the tool runs; cost is added at the end.

### S2 Lost session
- **Given** a task with a stale `sessionId` and the SDK failing with "No conversation found"
- **When** the run executes
- **Then** a new session starts once and the task finishes `done`, not `failed`.

### S3 Message while running
- **Given** a running task
- **When** a person posts `/messages`
- **Then** 202 `{queued:true}`; after the run ends the queued text runs as the next turn.

### S4 Edit a message
- **Given** a done task with two user turns and no changes made
- **When** the second user message is edited
- **Then** later events are gone, `historyVersion` is 1, the new session receives the earlier transcript, and the thread shows the new text.

### S5 Edit refused
- **Given** the agent made an approved change after the message
- **When** that message is edited
- **Then** 409 and nothing is deleted.

### S6 Restart
- **Given** a running task with a session, and a waiting task with an open approval
- **When** `recoverAfterRestart` runs
- **Then** the first fails without invoking the SDK; the second keeps its open approval marked `detached`; deciding it records the decision and waits for an explicit continuation (see SPEC-tasks-05 FR-5).

## Interfaces
- HTTP (all under `/api/tasks`): `GET /` (`type,status,limit`), `POST /` (`type,title,prompt,context,permission,notify`; 201), `GET /:id` (task + events), `DELETE /:id`, `PATCH /:id` (`{permission}`), `GET /:id/logs`, `POST /:id/messages` (`text,permission,context`; 202), `PATCH /:id/messages/:eventId`, `POST /:id/cancel`, `PATCH|DELETE /:id/queue/:msgId`, `POST /:id/queue/:msgId/send`, `GET /:id/files`, `/files/content?path=`, `/files/raw?path=`, `GET /:id/events` (SSE). Errors: thrown `Error` without status map via the shared handler (validation errors), `statusCode` 404/409 where set.
- Task fields: `id,type,title,summary,report,status,permission,notify,context{ticket|routine|page},createdBy,createdAt,updatedAt,startedAt,finishedAt,sessionId,cost,pendingApprovalId,changes,error,grants,restarts,historyVersion,queue(derived)`.
- Statuses: `queued|running|waiting|done|failed|cancelled`.
- Storage: files `RUNTIME_DIR/tasks/{index.json,inbox.json,events/<id>.json}` or Postgres `ops_tasks`, `ops_task_events(task_id,seq,...)`, `ops_inbox`, `ops_task_seq` (when `OPS_METADATA_STORE=postgres`). Task folder: `workspace/tasks/<id>/`.
- Env: `OPS_MAX_CONCURRENT_TASKS`, `OPS_MAX_TURNS_PER_RUN`, `OPS_AGENT_MODEL`, `OPS_AGENT_EFFORT`, `OPS_AGENT_NAME`, `OPS_RECOVER_ON_BOOT`.

## Non-functional constraints
- Event append is serialised per store (file mutex / PK retry up to 5 on Postgres) so `seq` is gapless.
- Raw task files never run script on the API origin (sandbox CSP, `nosniff`).
- Process-wide listener limit raised to 1000 for SSE subscribers.
- Costs are recorded per run; failures are logged with `[tasks]`/`[sdk <id>]` prefixes.

## Known gaps / deviations
- DESIGN.md says task permission default is `ask`; code default is `policy` (and `read-only` for automatic triage).
- `earlyDecisions` is in memory: a decision parked for a gate that never registers is never cleaned.
- `editMessage` does not refuse a `cancelled` task, and does not check that the new session sees tool state from before the edit.
- `DELETE /api/tasks/:id` race: `active`/status checked, then store deleted without a lock.
- Untested: `deleteTask`, `setPermission`, HTTP routes and SSE endpoint, file serving, Postgres store, second-restart failure, adhoc-waiting recovery, concurrency cap, notifications, 45 s notification rule.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `backend/src/tasks/task-runtime.mjs:77`, `:65` | `backend/tests/tasks.test.mjs:127` (partial) |
| FR-3 | `task-runtime.mjs:315-323` | none |
| FR-4, FR-5, FR-7 | `task-runtime.mjs:325-378`, `:550-577` | `backend/tests/tasks.test.mjs:127` |
| FR-6 | `task-runtime.mjs:584-601` | `backend/tests/agent-cards.test.mjs:103` |
| FR-8, FR-9, FR-10 | `task-runtime.mjs:360-377` | `backend/tests/tasks.test.mjs:196` (partial) |
| FR-11 | `task-runtime.mjs:37,348-354` | `backend/tests/tasks.test.mjs:168` |
| FR-12, FR-13 | `task-runtime.mjs:90-109`, `:315-321` | `backend/tests/tasks.test.mjs:223` |
| FR-14 | `task-runtime.mjs:153-190` | `backend/tests/tasks.test.mjs:295` |
| FR-15, FR-16 | `task-runtime.mjs:117-144` | `backend/tests/task-edit.test.mjs:52,85,100` |
| FR-17 | `task-runtime.mjs:205-213` | `backend/tests/tasks.test.mjs:196` |
| FR-18 | `task-runtime.mjs:216-224` | none |
| FR-19 | `task-runtime.mjs:197-203` | none |
| FR-20 | `task-runtime.mjs:267-303` | `backend/tests/agent-tools.test.mjs:36` (approval case only) |
| FR-21 | `backend/src/tasks/agent-model.mjs:17-23` | `backend/tests/agent-model.test.mjs:16,27,39` |
| FR-22 | `task-runtime.mjs:380-463` | `backend/tests/agent-model.test.mjs:39` (partial) |
| FR-23 | `backend/src/api/task-routes.mjs:97-111` | none |
| FR-24 | `task-routes.mjs:11-41,85-96` | none |
| FR-25 | `backend/src/tasks/task-store.mts:28,56` | none |
| FR-26 | `backend/src/api/task-routes.mjs:125` | `backend/tests/task-logs-rbac.test.mjs` |

## Open questions
- Should the queue survive restarts?
