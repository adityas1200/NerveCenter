---
id: SPEC-tasks-09
title: Task files live in the Details sheet, not in the thread
status: implemented
area: tasks
owners: []
code:
  - backend/src/tasks/task-runtime.mts
  - frontend/src/features/tasks/TaskPage.tsx
last_verified: 2026-10-11
---

# Task files live in the Details sheet, not in the thread

## Purpose
A task's Result page used to end with a Files section. Sending an email left `email.html`, `email.txt`, `email-content.json` and `preview-request.json` behind, and they all showed there although the person had already seen the email preview, and every file is in the side panel's Files tab anyway. The Result page now holds the outcome only; files are in the Files tab. The agent still links only the files a person needs from its reply.

## History
- 2026-10-11: SPEC-tasks-10 made the task page one thread. The Result page and the rail's Files tab are gone; the files are listed in the Details sheet, and nothing in the thread lists them.
- 2026-10-07: first version listed only the files the agent shared (linked or shown with `show_artifact`) on the Result page, with a "N working files in the Files tab" line. Same day, by a human decision, the Result page's Files section was removed entirely; the old FR-1 (shared files), FR-2, FR-3 and FR-6 are withdrawn.

## Scope
- In scope: the Result page's Files section, the prompt rule on linking files.
- Out of scope: the side panel's Files tab, the task files API (still fetched), what files skills write, deleting files.

## Requirements
- **FR-4** The Details sheet (SPEC-tasks-10 FR-3) SHALL list every file in the task folder, marking the ones Sonic showed with `show_artifact`.
- **FR-5** The appended system prompt SHALL ask the agent to link only the files a person needs to read, open or forward (the write-up, a CSV of evidence, a document asked for), and not to link working files such as request payloads, JSON inputs to scripts, text copies of an email, or files whose content a card (show_artifact, an email preview) already showed.
- **FR-7** The thread SHALL NOT list the task's files. Artifacts the agent showed with `show_artifact`, and files linked from the reply, still render and open as before.

## Scenarios
### S1 Email sent
- **Given** a task folder with `email.html`, `email.txt`, `email-content.json`, `preview-request.json` and `report.md`
- **When** the task page renders
- **Then** the thread lists none of them; the Details sheet lists all five.

### S2 Prompt
- **When** the SDK options are built
- **Then** `systemPrompt.append` holds the FR-5 rule and no longer says to link every file.

## Interfaces
- No API, event or storage change. The frontend still fetches the task's files for the Details sheet and the file viewer.

## Non-functional constraints
- None.

## Known gaps / deviations
- None.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-4 | `TaskPage.tsx` `TaskDetails` | `frontend/src/features/tasks/artifacts.test.tsx`, `taskDetails.test.tsx` |
| FR-5 | `task-runtime.mts` `#nerveCenterContext` | `backend/tests/shared-files.test.mjs` |
| FR-7 | `TaskThread.tsx` | `frontend/src/features/tasks/taskDetails.test.tsx` |

## Open questions
- None.
