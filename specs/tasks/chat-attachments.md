---
id: SPEC-tasks-11
title: Attach files and images to a message
status: implemented
area: tasks
owners: []
code:
  - backend/src/tasks/attachments.mjs
  - backend/src/tasks/task-runtime.mts
  - backend/src/api/task-routes.mjs
  - frontend/src/features/tasks/TaskComposer.tsx
  - frontend/src/features/tasks/attachments.ts
  - frontend/src/features/tasks/TaskThread.tsx
  - frontend/src/api/tasks.ts
last_verified: 2026-10-12
---

# Attach files and images to a message

## Purpose
People want to show Sonic a screenshot of a failing job, a PDF runbook or a CSV extract the way they would in any chat app: press +, drop the file on the box, or paste a screenshot. The file is saved in the task's folder and Sonic opens it with the SDK's Read tool, which reads images and PDFs natively, so there is no OCR step.

## Scope
- In scope: the message box on New task, the task page and the Sonic panel; new tasks and follow-ups; showing a message's files in its bubble and in the Details sheet.
- Out of scope: Word and Excel files (backlog), sending images to the SDK as content blocks, attaching files to a queued message after it was sent, changing a message's files when editing it.

## Actors and permissions
Anyone who can send a message (`tasks.manage`) can attach files to it. Viewers cannot. Attachments are served by the existing task file routes, which check the task's project.

## Requirements
- **FR-1** The message box SHALL accept files from a + button, drag and drop onto the box, and pasting from the clipboard. The + SHALL open a menu with two choices, Images (PNG, JPG, GIF, WebP) and Files (PDF and the text types), and each SHALL open the file picker limited to its own types, so the system dialog greys out or hides the rest.
- **FR-2** Each picked file SHALL show as a chip (a thumbnail for images) with a button to remove it before sending. A file of a type that is not allowed, or over the limits (FR-4), SHALL be left out with an inline message naming it.
- **FR-3** Allowed types SHALL be png, jpg, jpeg, gif, webp, pdf, txt, md, csv, tsv, json, yaml, yml, sql, log, and (SPEC-knowledge-03 FR-4) docx, xlsx, pptx and vtt. The backend SHALL decide by extension and SHALL reject an image, PDF, Office file (not a zip container) or transcript (not starting `WEBVTT`) whose bytes do not match its type. *Amended 2026-10-13 by SPEC-knowledge-03.*
- **FR-4** A message SHALL hold at most 10 files, each at most 10 MB and 25 MB together. The backend SHALL enforce the same limits with a 400 that names the file, and a 413 when the request body is larger than the limit allows. Everything in the request except the files SHALL keep the normal request limit (`OPS_MAX_REQUEST_BYTES`).
- **FR-5** `POST /api/tasks` and `POST /api/tasks/:id/messages` SHALL accept an optional `attachments: [{name, data}]` (base64, a `data:` prefix allowed). A message SHALL be sendable with files and no text; the text the agent and the thread get is then "Take a look at the attached file(s)."
- **FR-6** The files SHALL be saved under the task folder at `attachments/<message id>/<name>`, with names cleaned to safe file names and duplicates in one message numbered. Nothing SHALL be written outside the task folder.
- **FR-7** The message the agent gets SHALL list each attachment's path from the workspace, type and size, and ask it to open them with Read.
- **FR-8** The `user.message` event and a queued message SHALL carry `attachments: [{name, path, size, mime}]` with `path` relative to the task folder. Records without the field SHALL read as having no attachments.
- **FR-9** A queued message, a message sent now from the queue, a task requeued after a restart, and an edited message SHALL keep the files of the message they came from.
- **FR-10** The thread SHALL show a message's attachments in its bubble: image thumbnails and file chips that open the file in the file viewer.
- **FR-11** Attachments SHALL be listed in the task's Details sheet with the other task files, and the list SHALL refresh after a message with files is sent.

## Scenarios
### S1 Screenshot pasted into a follow-up
- **Given** an open task
- **When** the person pastes a screenshot and sends "why did this fail?"
- **Then** `attachments/<message id>/image.png` is in the task folder, the bubble shows its thumbnail, the agent's message names `tasks/<task id>/attachments/<message id>/image.png`, and the Details sheet lists it.

### S2 Files only
- **When** the person drops a PDF on the New task box and sends with no text
- **Then** a task starts with the text "Take a look at the attached file." and the PDF.

### S3 Wrong type or too big
- **When** the person drops `notes.doc` or a 12 MB image
- **Then** it is not added and the box says why; a request that sends one anyway gets a 400 naming the file.

### S4 Queued and edited
- **Given** a running task
- **When** the person sends a message with a file, and later edits that message
- **Then** the queued message, the run it starts, and the run after the edit all list the file.

## Interfaces
- HTTP API: `POST /api/tasks` and `POST /api/tasks/:id/messages` gain `attachments`. 400 for a bad type, count, size, empty file or bytes that do not match the type; 413 above the body limit (about 36 MB).
- Data model: optional `attachments` on `user.message` event data, on `pendingMessages[]` entries and on `pendingStart`. All three are JSON already, in both the file and Postgres stores, so no migration.
- Files: `<project workspace>/tasks/<task id>/attachments/<message id>/<name>`, synced with the rest of the workspace.
- UI: `TaskComposer` (+ menu, drop zone, paste, chips), `UserBubble` (attachments), Details sheet (files).

## Non-functional constraints
- The agent reads attachments through Read, inside the project workspace that the path guard already allows; Office files through the plugin's extraction script or Python.
- Names are cleaned, never trusted as paths; the type comes from the extension, not the browser's MIME.

## Known gaps / deviations
- None for file types: Word, Excel and PowerPoint files are read through the plugin's document extraction or Python (SPEC-knowledge-03 FR-5), not Read.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `TaskComposer.tsx`, `attachments.ts` | `frontend/src/features/tasks/TaskComposer.attachments.test.tsx` |
| FR-3, FR-4, FR-6 | `attachments.mjs` | `backend/tests/task-attachments.test.mjs` |
| FR-5 | `task-routes.mjs` | `backend/tests/task-attachments.test.mjs` |
| FR-7, FR-8, FR-9 | `task-runtime.mts` | `backend/tests/task-attachments.test.mjs` |
| FR-10 | `TaskThread.tsx` `UserBubble` | `frontend/src/features/tasks/TaskComposer.attachments.test.tsx` |
| FR-11 | `TaskPage.tsx` | `frontend/src/features/tasks/TaskComposer.attachments.test.tsx` |

## Open questions
- None.
