---
id: SPEC-knowledge-06
title: Knowledge evals and journeys
status: implemented
area: knowledge
owners: [mitesh.shinde]
code:
  - backend/src/knowledge/knowledge-journeys.mjs
  - backend/src/knowledge/knowledge-service.mts
  - backend/src/api/library-routes.mjs
  - backend/src/tasks/nervecenter-tools.mts
  - backend/src/tasks/nervecenter-tool-categories.mjs
  - frontend/src/api/library.ts
  - frontend/src/features/knowledge/KnowledgeHealth.tsx
  - plugin/operations-fleet/skills/knowledge-eval/
last_verified: 2026-10-20
---

# Knowledge evals and journeys

## Purpose

Sonic's accuracy on a client is the quality of the client's knowledge. To show it, and to know where to interview next, each journey (late pipeline triage, brand data requests, DQ failures) has eval cases built from real resolved work. Sonic answers each case using only the knowledge, a grader compares the answer with what was actually done, and NerveCenter keeps a score per journey over time.

## Scope

- In scope:
  - the eval case page format;
  - the `knowledge-eval` skill;
  - the `record_eval_run` tool;
  - the run history;
  - the journeys API and view.
- Out of scope: changing what Sonic may do by journey (autonomy, a later spec), scoring people.

## Actors and permissions

| Actor | Can |
|---|---|
| Any project member | Read journeys (`GET /api/knowledge/journeys`). |
| Sonic | Writes eval cases as drafts (`update_knowledge`, `origin: eval`); records a run in a task (`record_eval_run`). |
| Project owner | Keeps or discards eval cases like any draft (decided 20 Oct 2026). |

## Requirements

### Cases

- **FR-1** An eval case SHALL be a kept page in a base's `evals/` folder with `type: Eval Case`, a `journey` (a short kebab-case name), `expected` (one line: the right action or answer), optional `cites` (pages a good answer reads) and optional `source` (the ticket it came from). Its body has `## Ask` (the question or ticket as the person saw it) and `## Expected`. Only kept cases count; drafts are proposals.
- **FR-2** The journey list SHALL be the set of `journey` values on kept cases (decided 20 Oct 2026: no separate configuration).

### Runs

- **FR-3** `record_eval_run {journey, cases[], ...reason}` SHALL record one run.
  - Each case has `path`, `result` (`pass`, `partial` or `fail`), an optional `note` (max 300) and optional `missing` (pages the answer should have used, max 5).
  - The score SHALL be computed by NerveCenter: pass = 1, partial = 0.5, fail = 0, divided by the number of cases and rounded to a whole percent. The model's own number is never used.
  - At most 60 cases a run, journeys at most 60 characters in kebab case.
  - A case path that is not an `evals/` page SHALL refuse the call.
- **FR-4** A run SHALL be written to the task's folder as `eval-run-<journey>.json`, and appended to the project's run history in `knowledge/.journeys.json`, keeping the latest 26 runs per journey and at most 40 journeys (the least recently run dropped first). Old or missing history reads as empty.
- **FR-5** `GET /api/knowledge/journeys` SHALL return each journey with:
  - `cases` (kept cases now);
  - `latest` (`score`, `passed`, `partial`, `failed`, `total`, `at`, `taskId`);
  - `previous` score;
  - `trend` (up to 12 scores, oldest first);
  - `failing` (latest run's fail and partial cases with notes, max 10).

  Journeys with cases and no run come back with `latest: null`. The list is sorted weakest first, with unrun journeys last.

### Skill

- **FR-6** The `knowledge-eval` skill SHALL:
  - find the kept cases for a journey (or all);
  - answer each case in a fresh subagent that gets only the `## Ask` text and the knowledge and read-only tools, never the expected answer;
  - grade the answer against `## Expected` and `cites` with a fixed rubric;
  - call `record_eval_run` once per journey;
  - report the score, the change since last time, and the pages that would have fixed each failure.
- **FR-7** The `knowledge-build` skill SHALL turn resolved tickets into eval cases during setup: up to 10 per top journey, drafted with `origin: eval`. Its self-check SHALL run the eval skill.

### UI

- **FR-8** The Knowledge page SHALL show a Journeys panel. One row per journey with:
  - its name;
  - the latest score as a ring;
  - the change since the previous run;
  - a sparkline of the trend;
  - case count and last run time.

  Opening a row shows the failing cases with notes, and links to the run's task. The panel has loading, empty ("No eval cases yet") and error states. Scores count up on first view.

## Scenarios

### S1 Score
- **Given** 4 kept cases in journey `late-pipeline`
- **When** Sonic records pass, pass, partial, fail
- **Then** the score is 63, the task folder has `eval-run-late-pipeline.json`, and the journeys list shows 63 with the earlier score as `previous`.

### S2 Not a case
- **When** a case path is `runbooks/x.md`
- **Then** the call is refused, and nothing is recorded.

### S3 History cap
- **When** a journey has 26 runs and another is recorded
- **Then** the oldest is dropped.

## Interfaces

- **HTTP:** `GET /api/knowledge/journeys`.
- **Tool:** `record_eval_run`, category `task_files` (it writes the task's folder; the history file is NerveCenter's index of those runs).
- **Data:**
  - `knowledge/.journeys.json`: `{journeys: {<name>: {runs: [{at, taskId, score, passed, partial, failed, total, cases}]}}}`;
  - `eval-run-<journey>.json` in the task folder.

  No database table. File mode and the S3-synced workspace keep it like `.drafts.json`.
- **UI:** the `KnowledgeHealth` Journeys panel.

## Non-functional constraints

- Reading journeys reads the history file and walks at most 400 pages per base for the case count.
- Eval runs cost tokens. The weekly pass runs them once a week (decided 20 Oct 2026); per-PR runs are not built.

## Known gaps / deviations

- In file mode, two processes recording a run at the same instant can lose one; file mode is single-process by design.

## Traceability

| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2, FR-5 | `knowledge-journeys.mjs` | `backend/tests/knowledge-journeys.test.mjs` |
| FR-3, FR-4 | `knowledge-journeys.mjs`, `nervecenter-tools.mts` | `backend/tests/knowledge-journeys.test.mjs` |
| FR-6, FR-7 | `plugin/operations-fleet/skills/knowledge-eval/`, `knowledge-build` | plugin validator, unit tests |
| FR-8 | `KnowledgeHealth.tsx` | `frontend/src/features/knowledge/KnowledgeHealth.test.tsx` |
