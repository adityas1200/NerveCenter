---
id: SPEC-knowledge-07
title: Weekly knowledge pass and digest
status: implemented
area: knowledge
owners: [mitesh.shinde]
code:
  - backend/src/knowledge/knowledge-journeys.mjs
  - backend/src/knowledge/knowledge-pass.mjs
  - backend/src/api/library-routes.mjs
  - backend/src/api/server.mjs
  - backend/src/tasks/nervecenter-tools.mts
  - backend/src/tasks/nervecenter-tool-categories.mjs
  - frontend/src/api/library.ts
  - frontend/src/features/knowledge/KnowledgeHealth.tsx
  - plugin/operations-fleet/skills/knowledge-pass/
last_verified: 2026-10-20
---

# Weekly knowledge pass and digest

## Purpose

Knowledge goes stale and drafts pile up. Once a week Sonic:

- goes through the week's work and finds where it got stuck or was corrected;
- merges duplicate drafts;
- lists pages past their review date;
- checks typed fields against the live systems;
- notices changed source documents;
- runs the evals.

The owner gets one digest: what to keep, what is stale, where accuracy moved. Nothing becomes knowledge without a person.

## Scope

- In scope:
  - the routine the owner turns on from the Knowledge page;
  - the `knowledge-pass` skill;
  - the `record_knowledge_digest` tool;
  - the digest history;
  - the "This week" panel.
- Out of scope: changing pages without review; email delivery beyond the routine's normal Inbox notification (the email connector can be asked for in the routine objective later).

## Actors and permissions

| Actor | Can |
|---|---|
| Project owner | Turns the weekly pass on or off and picks the day and time (`knowledge.review`). |
| Any project member | Reads the pass state and the latest digest. |
| Sonic | Runs the routine with the workspace policy, drafts (`update_knowledge`, `origin: pass`), runs evals, records the digest. |

## Requirements

- **FR-1** `GET /api/knowledge/pass` SHALL return `{enabled, weekday, time, timezone, routine: {name, nextRunAt, lastRun} | null, digest: <latest> | null}`.
- **FR-2** `PUT /api/knowledge/pass {enabled, weekday?, time?}` SHALL need `knowledge.review`.
  - With `enabled: true` it SHALL save the routine `knowledge-pass` through the routines service. The routine is titled "Weekly knowledge pass", runs weekly (default Monday 07:00 in the workspace timezone), uses permission `policy`, notifies on completion, and has the fixed objective that runs the `knowledge-pass` skill.
  - With `enabled: false` it SHALL pause the routine, and a missing routine is not an error.
  - `weekday` is 0 to 6 and `time` is `HH:MM`; anything else gets 400.
  - The routine shows on the Routines page like any other.
- **FR-3** `record_knowledge_digest` SHALL work only in a run of the `knowledge-pass` routine. Elsewhere it SHALL error "The digest belongs to the weekly knowledge pass", and write nothing. It takes:
  - `drafts: {waiting, fromCorrections, fromLessons, merged}`;
  - `stale[]` (`path`, `staleAfter`, max 20);
  - `drift[]` (`path`, `field`, `page`, `live`, max 20);
  - `changedDocs[]` (`path`, `source`, max 20);
  - `gaps[]` (`text`, `journey?`, `tasks[]`, max 10);
  - `evals[]` (`journey`, `score`, `previous?`);
  - `weakest?`;
  - `summary` (max 400);
  - and the reason.

  Text fields are capped, and a likely secret refuses the call.
- **FR-4** The digest SHALL be written to the task folder as `knowledge-digest.json` and appended to `knowledge/.journeys.json` under `digests`, keeping the latest 12, each with `at` and `taskId`.
- **FR-5** The `knowledge-pass` skill SHALL:
  - read the week's tasks (`list_tasks` since 7 days ago, `get_task_log`);
  - take stuck points from the signals (questions asked, rejected or blocked actions, interruptions, tool errors) and the `evaluate` pushback labels;
  - list drafts waiting per base;
  - merge duplicate drafts by appending to one and noting the other in the digest (it never discards);
  - list pages past `stale_after` from the catalog;
  - check typed fields that a live tool can confirm (pipeline schedule and owner, tables in `refs`) and report drift;
  - check cited documents' modified dates through their connector when one is connected;
  - run the `knowledge-eval` skill;
  - draft fixes for clear gaps with `origin: pass`;
  - call `record_knowledge_digest` once;
  - end with a two-line summary.
- **FR-6** The Knowledge page SHALL show a "This week" panel:
  - the weekly pass switch (owners only; others see On or Off) with its next run;
  - the latest digest's counts as tiles (drafts waiting, stale pages, drift, gaps), each opening its list;
  - the eval movements;
  - the weakest journey;
  - a link to the run's task.

  The panel has loading, empty ("No pass yet") and error states. Switching the pass on or off shows a toast and refetches.

## Scenarios

### S1 Turn on
- **When** an owner switches the weekly pass on
- **Then** `workflows/knowledge-pass.yaml` exists with a weekly Monday 07:00 trigger and permission policy, and the panel shows the next run.

### S2 Not an owner
- **When** a developer calls `PUT /api/knowledge/pass`
- **Then** they get 403.

### S3 Digest outside the routine
- **When** an ordinary task calls `record_knowledge_digest`
- **Then** it errors, and nothing is written.

### S4 Digest
- **When** the pass records a digest with 9 drafts waiting, 3 stale pages, 1 drift and evals 78 → 84
- **Then** `GET /api/knowledge/pass` returns that digest, and the panel shows it.

## Interfaces

- **HTTP:**
  - `GET /api/knowledge/pass`;
  - `PUT /api/knowledge/pass` (`knowledge.review`).
- **Tool:** `record_knowledge_digest`, category `task_files`.
- **Data:** `digests` in `knowledge/.journeys.json`; `knowledge-digest.json` in the task folder; `workflows/knowledge-pass.yaml`. No database table.
- **UI:** the `KnowledgeHealth` "This week" panel.

## Known gaps / deviations

- FR-5 is method in the skill. Tests check the routine, the tool and the storage; the live run checks the method.

## Traceability

| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `knowledge-pass.mjs`, `library-routes.mjs` | `backend/tests/knowledge-pass.test.mjs` |
| FR-3, FR-4 | `knowledge-journeys.mjs`, `nervecenter-tools.mts` | `backend/tests/knowledge-pass.test.mjs` |
| FR-5 | `plugin/operations-fleet/skills/knowledge-pass/` | plugin validator, unit tests |
| FR-6 | `KnowledgeHealth.tsx` | `frontend/src/features/knowledge/KnowledgeHealth.test.tsx` |
