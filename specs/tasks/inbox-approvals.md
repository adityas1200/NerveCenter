---
id: SPEC-tasks-05
title: Inbox and approvals (approve, deny, answer, read)
status: implemented
area: tasks
owners: []
code:
  - backend/src/tasks/task-runtime.mjs
  - backend/src/tasks/task-store.mts
  - backend/src/api/task-routes.mjs
  - frontend/src/features/inbox/InboxPage.tsx
  - frontend/src/features/inbox/inboxItems.ts
  - frontend/src/features/inbox/useInboxPending.ts
  - frontend/src/api/inbox.ts
  - frontend/src/features/tasks/QuestionPrompt.tsx
last_verified: 2026-10-12
---

# Inbox and approvals

## Purpose
The Inbox is where the agent hands decisions to people: approvals for writes the policy does not allow outright, questions the agent needs answered, and notifications about finished or failed tasks. Deciding resumes the paused agent.

## Scope
- In scope: Inbox item model and lifecycle, `/api/inbox` routes, `decideApproval`, `answerQuestion`, restart-safe decisions, approval stats, Inbox page and sidebar badge, inline approval prompt and question form.
- Out of scope: when an approval is requested (SPEC-tasks-03), question tool schema (SPEC-tasks-04), Settings autonomy UI that consumes stats.

## Actors and permissions
- Any authenticated user may list items in their authorized project scope. Project developers and owners and app admins may approve, deny and answer (`approvals.decide`); project viewers may read but not decide. The older contrary permission note was stale.

## Requirements
- **FR-1** Inbox items SHALL have `id` `I-<8 hex>`, `kind` (`approval|question|notification`), `status` (`pending|approved|denied|answered|read|cancelled`, new items `pending`), `taskId`, `title`, `detail`, `tone`, `createdAt`, `updatedAt`.
- **FR-2** An `approval` item SHALL carry `category`, `categoryLabel`, `fingerprint`, optional `reason` (agent's sentence, max 240) and `tool {name, input}` (JSON string, long strings cut at 24000); a `question` item with options SHALL carry `questions[]` (see SPEC-tasks-04 FR-11); a legacy question (reply of an unattended task that ends with `?`) has no `questions`.
- **FR-3** `GET /api/inbox` SHALL support existing `status`, `kind`, `taskId` filters and the Inbox views (`all|needs_action|done`), plus bounded `limit` and nonnegative `offset`. It SHALL apply project scope and view filters, collapse notifications to the newest per task, then return the newest page and exact `total`. `pending` SHALL count pending approvals and questions across the authorized scope; `approvals` and `unread` SHALL likewise count their eligible full-scope items.
- **FR-4** `POST /api/inbox/:id/approve|deny` (`decideApproval`) SHALL 404 for an unknown item, reject anything that is not an approval, reject a question with options unless the decision is deny (message tells to answer with options), reject items no longer `pending`, and record `status`, `decidedAt`, `decidedBy {id,name}`.
- **FR-5** If the agent is waiting on the item, the decision SHALL resolve its promise; if the item is not yet registered but the task is active, the decision SHALL be parked and applied when the gate registers. If the agent is gone, an `approval.decided` event SHALL be recorded and, unless the task is cancelled, a one-time grant added for approval, but the interrupted task SHALL remain `failed` until the person explicitly continues it (ADR 0013). The decision SHALL NOT automatically retry a tool step.
- **FR-6** `POST /api/inbox/:id/answer {answers:{<question text>:<string>}}` (`answerQuestion`) SHALL 404 unknown, reject non-structured or non-pending items, keep only non-empty string answers for the item's own questions (each cut at 1000 chars), require at least one, record `status:'answered'`, `answers`, `decidedBy` and a `question.answered` event, then resolve the waiting tool call, park it, or (agent gone) retain the answer and require explicit continuation.
- **FR-7** Denying a structured question SHALL decline it: the agent is told to continue with its own judgement.
- **FR-8** `POST /api/inbox/:id/read` SHALL 404 unknown, return 400 for a pending approval, and otherwise set `status:'read'` and `readBy`.
- **FR-9** Sending a message to a task SHALL mark its pending `question` items `read`; cancelling or editing a message SHALL cancel its pending items and deleting a task SHALL delete them; a restart SHALL retain pending Inbox items and mark a waiting task's open approval as `detached`.
- **FR-10** `GET /api/inbox/stats?days=N` (default 30, clamp 1..365) SHALL group approval items decided or created in the window by `category` (default `default_write`) with counts `approved|denied|pending|cancelled`, `lastDecidedAt`, plus totals, sorted by decided count.
- **FR-11** Notifications SHALL be created on task failure (`bad`), on successful finish of unattended work or a chat that ran longer than 45 s (`success`), and when a task asks a legacy question (`question`, `warning`).
- **FR-12** The Inbox page SHALL open on "Needs action" (pending approvals and questions), offer filters All / Needs action / Done, refetch every 15 s, and show approvals open with category label, the agent's reason or detail, and a preview of the change (command, SQL, file body, up to three extra fields). The server SHALL filter and collapse notifications before paging.
- **FR-13** Approvals SHALL be decided inline (Approve / Deny). Bulk approval SHALL require explicit selection of approvals the person has reviewed; selection persists across pages within the same project and filter, shows the exact count, and clears when project or filter changes. Confirmation SHALL show the selected count. Each approval SHALL recheck scope, permission and pending status; processing stops on the first failure, reports how many succeeded and how many remain untouched, then refreshes. Structured questions SHALL be answered inline with `QuestionPrompt` (radio, or checkboxes when `multiSelect`, an "Other" typed answer, Send answers disabled until every question has an answer, Skip = deny); legacy questions SHALL link "Answer in the task".
- **FR-14** "Mark all read" SHALL mark every eligible non-action pending item in the authorized project scope. Settled items SHALL show `approved|denied|answered|skipped by <name>`; answered questions read back their answers.
- **FR-15** The sidebar badge SHALL count pending approvals and questions (poll 20 s).

## Scenarios
### S1 Approve in the Inbox
- **Given** a task waiting on an approval
- **When** the user clicks Approve
- **Then** the item is `approved` with `decidedBy`, the task returns to `running`, the write executes once.

### S2 Decide after restart
- **Given** the process restarted while an approval was open
- **When** it is approved
- **Then** a grant and decision event are stored, the task remains failed, and a person must explicitly continue it before the agent can attempt the step.

### S3 Answer a question
- **Given** a question with a multiSelect and a single-select
- **When** the user picks options and types an Other answer
- **Then** answers post keyed by question text (multi: `"A, B"`), the item is `answered`, the agent continues with `answers`.

### S4 Stale decision
- **Given** an item already decided
- **When** another user approves
- **Then** the request fails with "This approval was already approved/denied" and the UI shows a toast.

### S5 Stats
- **Given** decided approvals in three categories
- **When** `/api/inbox/stats` is called
- **Then** each category reports approved/denied counts inside the window.

## Interfaces
- HTTP: `GET /api/inbox?status&kind&taskId&limit`, `POST /api/inbox/:id/{approve,deny,answer,read}`, `GET /api/inbox/stats?days`.
- Storage: `inbox.json` (`items{}`) or Postgres `ops_inbox(id, task_id, kind, status, data, created_at, updated_at)`.
- UI: `/inbox` (`InboxPage`), approval prompt in the task thread (`ApprovalPrompt`), `QuestionPrompt`; query keys `["inbox",...]`.
- Task events: `approval.requested`, `approval.decided`, `approval.denied`, `question.asked`, `question.answered` carrying `inboxId`.

## Non-functional constraints
- A decision cannot be lost between item creation and the gate waiting (parked decision).
- Decisions are attributed (`decidedBy`) and appear in the task event stream, which serves as the audit trail; there is no separate audit table.
- Pending state is evaluated per item: a double-click on a decided item fails safely with a message.

## Known gaps / deviations
- The approver can be the requester; no separation of duties.
- DESIGN.md lists only `approve|deny|read`; `answer` and `stats` routes are not in its API list.
- `read` on a pending structured question is allowed and leaves the task waiting.
- Stats count `read`/other statuses as `cancelled`.
- Untested: `/read`, stats HTTP route, restart `detached` flag, notification creation rules, sidebar badge.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `backend/src/tasks/task-store.mts:42,70`, `backend/src/tasks/task-runtime.mjs:532` | `backend/tests/tasks.test.mjs:127` |
| FR-3 | `backend/src/api/task-routes.mjs`, `backend/src/tasks/task-store.mts` | `backend/tests/task-inbox-pagination.test.mjs`, `backend/tests/pagination-postgres.test.mjs` |
| FR-4 | `task-runtime.mjs:226-241` | `backend/tests/tasks.test.mjs:196` |
| FR-5 | `task-runtime.mjs:236-259`, `:534-537` | `backend/tests/agent-tools.test.mjs:36` |
| FR-6 | `task-runtime.mjs:490-508` | `backend/tests/questions.test.mjs:30` |
| FR-7 | `task-runtime.mjs:229,485` | `backend/tests/questions.test.mjs:58` |
| FR-8 | `task-routes.mjs:123` | none |
| FR-9 | `task-runtime.mjs:99,131-132,208,276-280` | `backend/tests/task-edit.test.mjs:52` (edit only) |
| FR-10 | `task-routes.mjs:48-62,117` | `backend/tests/agent-cards.test.mjs:127` |
| FR-11 | `task-runtime.mjs:362,373-374,603` | `backend/tests/tasks.test.mjs:196` (partial) |
| FR-12, FR-14 | `frontend/src/features/inbox/InboxPage.tsx`, `backend/src/api/task-routes.mjs` | `frontend/src/features/inbox/InboxPage.test.tsx`, `frontend/src/features/tasks/TaskInboxPagination.test.tsx`, `backend/tests/task-inbox-pagination.test.mjs` |
| FR-13 | `frontend/src/features/inbox/InboxPage.tsx`, `frontend/src/features/tasks/QuestionPrompt.tsx` | `frontend/src/features/tasks/TaskInboxPagination.test.tsx`, `frontend/src/features/tasks/QuestionPrompt.test.tsx` |
| FR-15 | `frontend/src/features/inbox/useInboxPending.ts:6-9`, `inboxItems.ts:4` | none |

## Open questions
- Who may approve: the requester, any developer, or admins for certain categories?
