---
id: SPEC-skills-02
title: operations-fleet plugin contract with the app
status: implemented
area: skills
owners: []
code:
  - plugin/operations-fleet/
  - backend/src/tasks/task-runtime.mjs
  - backend/src/workspace/workspace.mjs
  - backend/src/config.mjs
last_verified: 2026-10-03
---

# operations-fleet plugin contract with the app

## Purpose
`plugin/operations-fleet` is the vendored agent plugin (orchestrator, 16 skills, tools, evals). NerveCenter treats it as a read-only dependency that supplies the agent persona, built-in skills, the workspace template and the file conventions the app reads and writes. This spec covers only that boundary, not individual skills.

## Scope
- In scope: how the app locates, loads and reads the plugin; files the app depends on; file conventions shared with routines and knowledge.
- Out of scope: skill behaviour, plugin tests/evals (`plugin/operations-fleet/tests`, `evals`).

## Actors and permissions
Plugin files are never modified at runtime (skill removal refuses `plugin:*`; uploads go to the workspace).

## Requirements
- **FR-1** The plugin directory SHALL be `PLUGIN_DIR` = env `OPS_PLUGIN_DIR` (resolved) or `<repo>/plugin/operations-fleet`.
- **FR-2** Each task session SHALL load the plugin as `plugins: [{type: "local", path: PLUGIN_DIR}]` with `settingSources: ["project"]` and the workspace as cwd, so custom skills in `<workspace>/.claude/skills` and `operations.yaml`, `knowledge/`, `workflows/` are visible.
- **FR-3** The task runtime SHALL read `agents/orchestrator.md` from the plugin (frontmatter stripped) as the system prompt base; a missing file SHALL degrade to an empty string, not an error.
- **FR-4** The app SHALL treat every direct subfolder of `skills/` with a `SKILL.md` as a built-in skill; frontmatter keys `name` and `description` feed the Skills UI.
- **FR-5** On workspace init, if `operations.yaml` is absent the app SHALL seed it from `skills/setup/assets/operations.template.yaml`, else from a minimal `team: {name, timezone}` / `connections: {}` stub.
- **FR-6** Workflow (routine) files SHALL follow the plugin `workflow` skill shape: `name, objective, trigger{type,timezone,expression}, uses, authority, success, on_failure`; the app adds an `app:` block the plugin ignores (see SPEC-routines-02).
- **FR-7** Knowledge SHALL follow the plugin `knowledge` skill's index-first convention; the app maintains `knowledge/index.md` listing every base (SPEC-knowledge-01).
- **FR-8** The `init` event's skills list SHALL be filtered to names starting `operations-fleet:` when recorded on the task.
- **FR-9** The routine setup check SHALL report the number of plugin skills found (`listPluginSkills`).

## Scenarios
### S1 Fresh workspace
- **Given** an empty workspace dir
- **When** the workspace initialises
- **Then** `knowledge/`, `workflows/`, `.claude/skills/`, `tasks/` exist and `operations.yaml` comes from the plugin template.

### S2 Custom plugin dir
- **Given** `OPS_PLUGIN_DIR=/opt/plugin`
- **When** listing skills or starting a task
- **Then** both read and load from that path.

## Interfaces
- Config: `OPS_PLUGIN_DIR`; `backend/src/config.mjs:32`.
- Plugin files used: `agents/orchestrator.md`, `skills/*/SKILL.md`, `skills/setup/assets/operations.template.yaml`, `skills/orchestrate/references/html-report.md` (named in the system prompt), `settings.json` (`{"agent":"orchestrator"}`).
- Skill ids exposed to the UI: `plugin:<folder>`.

## Non-functional constraints
- Plugin skill count is asserted as 16 in `library.test.mjs`; adding or removing a skill needs that test updated.
- Plugin has its own Python tests and evals outside the app test suite.

## Known gaps / deviations
- The system prompt names `skills/orchestrate/references/html-report.md` and plugin scripts (`send_email.py`, `render_email.py`, `build_preview.py`) by path; no app test verifies they exist.
- `plugin/operations-fleet/AGENTS.md`/`CLAUDE.md` guidance (keep SOPs in knowledge, etc.) is not enforced by the app.
- The plugin's workflow skill says to use "the host's approved scheduler"; the app's own scheduler is minimal (no locking, no catch-up) so the plugin's recommended scheduler properties (missed-run behaviour, locking) are not provided.
- Frontend text helper `skillText.ts` hard-codes an acronym list; unknown acronyms render as plain words.
- No test covers FR-2 (SDK options) or FR-5 template seeding for the plugin template path.
- Vendored plugin has no version pin or update procedure recorded in the repo.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/config.mjs:32` | none |
| FR-2 | `backend/src/tasks/task-runtime.mjs:392-393` | none |
| FR-3 | `task-runtime.mjs:381` | none |
| FR-4 | `backend/src/workspace/workspace.mjs:222-236` | `backend/tests/library.test.mjs:19` |
| FR-5 | `workspace.mjs:112-116` | none |
| FR-6 | `backend/src/routines/routine-scheduler.mjs:79-101` | `backend/tests/routines.test.mjs:38` |
| FR-7 | `workspace.mjs:212` | `backend/tests/library.test.mjs:55` |
| FR-8 | `task-runtime.mjs:553` | none |
| FR-9 | `routine-scheduler.mjs:132` | `routines.test.mjs:38` (not asserted) |

## Open questions
- How is the vendored plugin updated and versioned?
