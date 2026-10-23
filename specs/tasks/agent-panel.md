---
id: SPEC-tasks-07
title: Agent panel and "Ask Sonic"
status: implemented     # idle polling revision approved and implemented 2026-10-11 (ADR-0010); FR-7 amended 2026-10-13 (SPEC-tasks-12)
area: tasks
owners: []
code:
  - frontend/src/components/ops/AgentPanel.tsx
  - frontend/src/components/ops/agentPanelContext.ts
  - frontend/src/features/tasks/TaskComposer.tsx
  - backend/src/tasks/task-runtime.mjs
last_verified: 2026-10-13
---

# Agent panel and Ask Sonic

## Purpose
Sonic is one click away on every page. A floating pill opens a side panel where a person chats with the agent, which is told what page, filters, rows and record the person is looking at. Rows can also hand a specific record to Sonic ("Ask Sonic"). Under the hood each conversation is an ad-hoc task.

## Scope
- In scope: pill, panel, per-page conversations, page context, `useAskSonic`, `useAgentScreen`, suggested prompts, how the backend uses `context.page`.
- Out of scope: thread rendering (SPEC-tasks-06), backend task behaviour (SPEC-tasks-01).

## Actors and permissions
- Operators/admins chat. Viewers (`me.role === 'viewer'`) see the work read-only; the composer is replaced by "Viewers can read Sonic's work but not chat." and message editing is off. This is UI-only.

## Requirements
- **FR-1** The panel provider SHALL render a pill "Ask Sonic" (bottom right) on every route except `/tasks/<id...>` (including `/tasks/new`); the pill SHALL read "Sonic is working" only when a running task belongs to the current user or is this page's own conversation, and SHALL show the number of pending approvals/questions.
- **FR-2** Ctrl/Cmd+J SHALL toggle the panel; Escape SHALL close it; clicking the scrim closes it.
- **FR-3** Conversations SHALL be kept per page family (`Tickets`, `Pipelines`, `Data quality`, `Tasks`, `Inbox`, `Routines`, `Skills`, `Knowledge`, `Connectors`, `Settings`, `Boards`, `Overview`; any other path is its own family) in `sessionStorage["nc-agent-panel-conversations"]` as `family -> taskId`; "New conversation" (shown when a task exists and is not live) SHALL drop only that family's mapping.
- **FR-4** With no conversation the panel SHALL greet by first name, say what it can see (page name, count of visible rows, open record) and list up to four page-specific suggested prompts; clicking one sends it.
- **FR-5** The first message SHALL create a task `type:'adhoc'`, `permission:'policy'`, with `context.page = {name, path, filters (query string), selection, visible (<=200), open, summary}`; later messages SHALL `POST /messages` with the refreshed `context.page`. If the stored task is cancelled, a new task SHALL be created instead.
- **FR-6** The backend SHALL store the latest `context.page` on the task and append it to the agent's system prompt (page, filters, open record, selection, up to 60 visible rows, summary, "this/these/here" = what is listed), and, when nervecenter tools exist, name the tool to call first for that page.
- **FR-7** `useAgentScreen({visible, open, summary})` SHALL publish a page's on-screen state to the panel and clear it on unmount; `useAskSonic()(selection, prompt)` SHALL set the selection (`{kind,id,title,detail?}`), open the panel and type the prompt into the box for the person to edit and send (amended 2026-10-13: the code already prefilled; SPEC-tasks-12 FR-9), clearing the selection on the next route change; outside the provider it SHALL do nothing.
- **FR-8** The panel SHALL render the same live thread as the task page in compact form (approvals and questions answerable inline, plan Adjust prefills the composer, Stop cancels the task), show the agent's current activity while live, and link "Open as a full task".
- **FR-9** The composer SHALL be a `TaskComposer`; while the agent works, new messages SHALL queue (see SPEC-tasks-01 FR-13).
- **FR-10** The panel SHALL fetch the stream only while open (`useTaskStream(open ? taskId : undefined)`).

## Scenarios
### S1 Ask from a row
- **Given** the Pipelines page with a failed run row
- **When** the user clicks Ask Sonic on it
- **Then** the panel opens, selection is that pipeline, a task starts with `context.page.selection`, and moving to another page clears the selection.

### S2 One conversation per page family
- **Given** a conversation on `/tickets` and another on `/monitor`
- **When** the user returns to `/tickets/OPS-3`
- **Then** the Tickets conversation is shown (family `Tickets`).

### S3 Pill hides on task pages
- **Given** `/tasks/T-1004` or `/tasks/new`
- **Then** no pill is rendered.

### S4 Working indicator
- **Given** a running task created by someone else
- **Then** the pill does not say "working".

## Interfaces
- UI: `AgentPanelProvider`, `AgentPill`, `AgentPanel`; context `useAgentPanel`, `useAskSonic`, `useAgentScreen`, `describePage`, `AGENT_NAME` ("Sonic").
- API: `POST /api/tasks`, `POST /api/tasks/:id/messages`, `POST /api/tasks/:id/cancel`, `GET /api/tasks/:id/events`, `GET /api/tasks?status=running`.
- Storage: `sessionStorage` key `nc-agent-panel-conversations`.
- Backend: `PageContext` fields consumed in `#nerveCenterContext`; `PAGE_TOOLS` map.

## Non-functional constraints
- Running-task poll every 10 s while tasks are running and every 60 s while idle; Inbox pending poll every 20 s. Polling pauses while the tab is hidden. The panel closes with a 300 ms slide.
- Page context caps: visible rows 200 sent / 60 shown to the agent; selection 1500 chars, summary 600, filters 800 in the prompt.
- Conversations vanish with the browser session (not persisted server-side per user/page; the tasks themselves persist and appear in `/tasks`).

## Known gaps / deviations
- `AGENT_NAME` in the frontend is a constant while the backend reads `OPS_AGENT_NAME`.
- Viewer restriction is UI-only; the panel's tasks are created through the same unrestricted API.
- The panel always creates `policy` tasks; there is no mode picker in it (the task page has one).
- DESIGN.md says "Ctrl+K opens New task"; this file only wires Ctrl+J (Ctrl+K not verified here).
- `PAGES` prompts exist for 12 families; `/tickets/...`-style detail routes share the family but not the open record unless the page calls `useAgentScreen`.
- Untested: keyboard shortcuts, Escape, new-conversation, viewer read-only message, family reuse across routes, suggested-prompt send beyond the first test.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `frontend/src/components/ops/AgentPanel.tsx:30,63-95` | `frontend/src/components/ops/AgentPanel.test.tsx:61,76` |
| FR-2 | `AgentPanel.tsx:42-48` | none |
| FR-3 | `AgentPanel.tsx:25-27,113-114,144` | none |
| FR-4 | `AgentPanel.tsx:170-182`, `frontend/src/components/ops/agentPanelContext.ts:73-91` | `frontend/src/features/tasks/TasksPages.test.tsx:197` |
| FR-5 | `AgentPanel.tsx:123-143` | `TasksPages.test.tsx:197`, `AgentPanel.test.tsx:91` |
| FR-6 | `backend/src/tasks/task-runtime.mjs:30,97,447-461` | none |
| FR-7 | `agentPanelContext.ts:44-67`, `AgentPanel.tsx:40-41` | `AgentPanel.test.tsx:91` |
| FR-8 | `AgentPanel.tsx:146-168` | `TasksPages.test.tsx:218` (thread) |
| FR-9 | `AgentPanel.tsx:186` | `TasksPages.test.tsx:247` |
| FR-10 | `AgentPanel.tsx:115` | none |
| Idle/active polling | `AgentPanel.tsx` `useAgentActivity` | `frontend/src/components/ops/AgentPanelPolling.test.tsx` |

## Open questions
- Should conversations per page family persist per user on the server?

## Manual refresh amendment (approved 2026-10-13)

Browser polling, focus/reconnect refetch and live task streaming are superseded by [Manual browser refresh](../platform/manual-refresh.md). Navigation, selection changes, explicit Refresh and affected user writes load data. Server jobs and APIs remain available.

## Live status note (2026-10-16)

FR-8's current activity is shown once, in the composer line under the thread (with the time on this reply); the thread's steps fold names the steps and does not repeat it. A viewer in the panel has no composer, so the thread shows it for them. The line follows the phase in the present tense: "Reading your message", a step as it happens ("Running ls", "Searching the web", or "Running a command" before its input arrives), "Thinking" between steps, "Writing the reply"; the composer hint replaces it while an approval or question waits. It never reads "About to <past tense>".
