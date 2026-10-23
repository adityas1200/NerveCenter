---
id: SPEC-tasks-06
title: Tasks UI (list, New task, task page, thread, live stream)
status: implemented
area: tasks
owners: []
code:
  - frontend/src/features/tasks/TasksPage.tsx
  - frontend/src/features/tasks/NewTaskPage.tsx
  - frontend/src/features/tasks/TaskPage.tsx
  - frontend/src/features/tasks/TaskThread.tsx
  - frontend/src/features/tasks/useTaskStream.ts
  - frontend/src/features/tasks/taskEvents.ts
  - frontend/src/features/tasks/PermissionMenu.tsx
  - frontend/src/features/tasks/QueuedMessages.tsx
  - frontend/src/features/tasks/TaskComposer.tsx
  - frontend/src/features/tasks/cards/
  - frontend/src/api/tasks.ts
last_verified: 2026-10-11
---

# Tasks UI

## Purpose
Let people start agent work, watch it live, steer it (queue, edit, stop, change what it may do), decide approvals and questions inline, and read the outcome, plan, cards, reports and files.

## Scope
- In scope: `/tasks` list, `/tasks/new`, `/tasks/:taskId` page (one thread, outcome line, Details sheet, logs; see SPEC-tasks-10), thread rendering, live stream hook, permission menu, queued messages, edit-message UI, cards and artifact frames.
- Out of scope: the per-page agent panel (SPEC-tasks-07), Inbox page (SPEC-tasks-05), backend (SPEC-tasks-01).

## Actors and permissions
- Viewer: message editing is off (panel and task page); the task page composer, stop, delete and permission controls are still rendered for viewers (see gaps).
- Admin (`useIsAdmin`): sees "Logs" and the "Act without asking" (`allow`) option; others only see `allow` if the task already has it.

## Requirements
- **FR-1** The list SHALL request `GET /api/tasks?type&archived&q&limit&offset` for the current page and refetch every 15 s. The server SHALL search title, summary, id, type detail and started-by with case-insensitive substring matching, then order the whole result as "Waiting on you" (`waiting`), "Running" (`running|queued`), "Earlier", newest update then id within each group, then page it. The response SHALL include exact `total`, `active` and `waiting` counts for the authorized scope. The list SHALL keep its current columns; type filter and search SHALL live in the URL (`?type=`, `?q=`); an invalid `type` means `all`.
- **FR-2** "Started by" SHALL read: `Routine · <title>` for routines; `Automatic triage · <number>` for system ticket tasks, `<person> · from ticket <number>` for people; `<person> · <page>` for chats; else `NerveCenter`.
- **FR-3** A failed task's row SHALL show the error, replaced by "Stopped with an error" when it looks technical (URLs, paths, HTTP verbs, error codes); status `cancelled` SHALL read "Stopped".
- **FR-4** Delete SHALL ask for confirmation, be disabled for queued/running tasks ("Stop it first to delete"), and surface backend errors as a toast.
- **FR-5** `/tasks/new` SHALL offer a composer (Enter sends), a mode chip (default `policy`), four suggestion cards that load a prompt and its suggested mode, and the six latest tasks; sending creates an `adhoc` task with `context.page {name:'New task', path:'/tasks/new'}` and navigates to it.
- **FR-6** The mode menu SHALL offer read-only ("Look only"), policy ("Follow policy"), ask, and allow ("Pre-approve everything", amber, only if the user is admin or it is already selected).
- **FR-7** `useTaskStream` SHALL load the task with events, then follow `GET /api/tasks/:id/events?after=<lastSeq>`, merge events by `seq`, ignore `seq <= last`, reconnect after 2 s when the stream drops, and refresh the Inbox queries when the task becomes `done|failed|waiting|cancelled`.
- **FR-8** Partial output SHALL show as a live draft: `text start|delta` build the draft, a `block stop` settles it, and the stored top-level `assistant.text` replaces it; sub-agent deltas (`parentToolUseId`) SHALL be ignored; a started tool is shown for at most 10 s until its `tool.use` event lands; drafts are shown only while `running|queued`.
- **FR-9** When the task's `historyVersion` differs from the one the reader first saw, the hook SHALL drop its events and draft, refetch the task and reopen the stream from seq 0.
- **FR-10** Only the approval/question the task currently waits on (`pendingApprovalId`) and that has no later decision SHALL be actionable; older ones SHALL be history without buttons.
- **FR-11** The thread SHALL group events into: user message, assistant text (top-level only), folded steps (session.init, tool calls/results, approvals), catalog components (SPEC-tasks-10), artifact frames, plan, findings, explained approvals, question (pending form or settled read-back), error (with "Send a message to continue" unless cancelled), and status lines; sub-agent text SHALL be hidden.
- **FR-12** The approval prompt SHALL show category label, the title or command (first 1200 chars), the agent's "Why" reason, file path/content or up to 8 fields, Approve and Deny, and a "Why am I asked?" link to `/settings?tab=policy`; after a decision it SHALL read "Approved. Sonic is continuing." or "Denied...".
- **FR-13** The composer SHALL send on Enter (Shift+Enter newline), turn into Stop while `busy` with `onStop`, and on the task page SHALL be disabled when the task is `cancelled` or waiting on an approval/question. A message sent while running SHALL appear as a dashed "Queued" bubble with Edit, Remove and Send now.
- **FR-14** Editing a sent message SHALL be available on hover for user messages when `editable` (not for viewers in the panel, not on cancelled tasks); Enter sends via `PATCH /messages/:eventId`, Escape cancels, an unchanged text just closes; a 409 from the backend SHALL show as a toast.
- **FR-15** Replaced by SPEC-tasks-10 FR-1 and FR-4 (2026-10-11): one thread, no tabs; a finished task opens at the top. Artifacts SHALL render in sandboxed iframes (`sandbox=""`) pointing at the raw file endpoint (HTML), with Expand, Taller and open-in-new-tab, where Sonic called `show_artifact`.
- **FR-16** The page header SHALL offer Stop (while live), Details (the sheet of SPEC-tasks-10 FR-3), Logs (admin only, raw events and cost, download JSONL), Delete with confirmation, and for ticket tasks "Mark resolved" and "Assign ticket to me", which update the ticket directly.
- **FR-18** The list's type tabs SHALL include Alerts (`type=alert`), and an automatic investigation's "Started by" SHALL read "Automation · <trigger>" (SPEC-automations-01 FR-42). The list SHALL page through the server with `usePager` (SPEC-platform-11).
- **FR-17** Replaced by SPEC-tasks-10 FR-3 (2026-10-11): the Details sheet lists files, changes, skills, knowledge, ticket or routine context and session facts (cost for admins); the steps live in each turn's fold.

## Scenarios
### S1 Start from New task
- **Given** the user picks "Find tickets ready to close"
- **When** they press Enter
- **Then** the box holds the prompt with mode Ask; a task is created with that mode and the page opens it.

### S2 Live reply
- **Given** a running task
- **When** text deltas arrive then the stored `assistant.text`
- **Then** the draft grows with a caret, and is replaced by the final block without duplication.

### S3 Pending approval
- **Given** `pendingApprovalId` set with an `approval.requested` event
- **When** the thread renders
- **Then** the prompt with Approve/Deny shows under the waiting step, and the composer is disabled.

### S4 Rewind
- **Given** a user edits an earlier message
- **When** the server bumps `historyVersion`
- **Then** every open reader reloads events and the thread shows only the new message and reply.

### S5 Queue
- **Given** a running task
- **When** the user sends a message
- **Then** a Queued bubble appears; Send now interrupts the step.

## Interfaces
- Routes: `/tasks`, `/tasks/new`, `/tasks/:taskId`. API client: `frontend/src/api/tasks.ts` (`tasksApi`), keys `taskKeys` in `api/inbox.ts`.
- Types: `Task`, `TaskEvent`, `TaskDelta`, `TaskPermission`; labels `TASK_STATUS_LABEL` (queued Queued, running Running, waiting "Waiting on you", done, failed, cancelled "Stopped"), `PERMISSION_LABEL`.
- States: list/task use `QueryState` (loading skeleton, error), empty list says "No tasks yet" / "No tasks match".
- Pages publish `useAgentScreen` (rows on screen) for the panel.

## Non-functional constraints
- The task page is a fixed-height layout whose thread scrolls on its own, with stick-to-bottom and a "New activity" pill.
- Agent-produced HTML never runs scripts (iframe sandbox plus server CSP).
- Accessibility: status marks have `aria-label`, composer buttons are labelled.

## Known gaps / deviations
- Role gating is UI-only and partial (Logs, `allow`, message edit); viewers can still use the task page composer and stop/delete.
- DESIGN.md says the Overview has agent lines built from the task list and Ctrl+K opens New task; this spec did not verify them (outside `features/tasks`).
- Frontend `AGENT_NAME` is hard-coded "Sonic" while the backend name is `OPS_AGENT_NAME`.
- The `waiting` status for chats never persists (backend turns it into `done`), so "Waiting on you" shows mainly approvals/questions and unattended tasks.
- Untested: list delete, Logs dialog, ticket header actions, permission change from the page, reconnect behaviour, `historyVersion` reset (see `useTaskStream.test.tsx` for questions only).

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-3, FR-4 | `frontend/src/features/tasks/TasksPage.tsx`, `backend/src/tasks/task-store.mts` | `frontend/src/features/tasks/TasksPages.test.tsx`, `frontend/src/features/tasks/TaskInboxPagination.test.tsx`, `backend/tests/task-inbox-pagination.test.mjs`, `backend/tests/pagination-postgres.test.mjs` |
| FR-2 | `frontend/src/api/tasks.ts:164-175` | `frontend/src/features/tasks/startedBy.test.ts` |
| FR-5 | `frontend/src/features/tasks/NewTaskPage.tsx:28-123` | `TasksPages.test.tsx:172` |
| FR-6 | `frontend/src/features/tasks/PermissionMenu.tsx:14-67`, `api/tasks.ts:177-183` | none |
| FR-7, FR-8 | `frontend/src/features/tasks/useTaskStream.ts:18-115` | `TasksPages.test.tsx:113` |
| FR-9 | `useTaskStream.ts:27-31,69-77` | none |
| FR-10 | `useTaskStream.ts:100-111` | `frontend/src/features/tasks/useTaskStream.test.tsx:25` |
| FR-11 | `frontend/src/features/tasks/taskEvents.ts:28-52`, `TaskThread.tsx:35-80` | `TasksPages.test.tsx:38,85`, `useTaskStream.test.tsx:35` |
| FR-12 | `TaskThread.tsx:558-601` | `TasksPages.test.tsx:85,138` |
| FR-13 | `TaskComposer.tsx:51-77`, `QueuedMessages.tsx:15-82`, `TaskPage.tsx:213` | `TasksPages.test.tsx:218,247` |
| FR-14 | `TaskThread.tsx:276-318` | `frontend/src/features/tasks/EditMessage.test.tsx:22,39` |
| FR-15 | `cards/ArtifactFrame.tsx`, `TaskThread.tsx` | `frontend/src/features/tasks/artifacts.test.tsx` |
| FR-16 | `TaskPage.tsx:165-178,424-455` | none |
| FR-17 | `TaskPage.tsx` `TaskDetails` | `TasksPages.test.tsx`, `taskDetails.test.tsx` |
| FR-18 | `TasksPage.tsx`, `frontend/src/api/tasks.ts` `startedBy` | `frontend/src/api/tasks.alert.test.ts` |

## Open questions
- Should the page hide composer/stop/delete from viewers?

## Manual refresh amendment (approved 2026-10-13)

Browser polling, focus/reconnect refetch and live task streaming are superseded by [Manual browser refresh](../platform/manual-refresh.md). Navigation, selection changes, explicit Refresh and affected user writes load data. Server jobs and APIs remain available.
