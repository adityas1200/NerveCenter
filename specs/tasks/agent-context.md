---
id: SPEC-tasks-08
title: Agent context at session start (skills shown, knowledge first, unslop on every reply, skill routing)
status: implemented  # FR-7..FR-9 approved and implemented 2026-10-07 (T-1144); FR-10 requested and implemented 2026-10-08; fast path removed (FR-8 revised) 2026-10-09
area: tasks
owners: []
code:
  - backend/src/tasks/task-runtime.mjs
  - plugin/operations-fleet/agents/orchestrator.md
  - plugin/operations-fleet/skills/monitoring/SKILL.md
  - frontend/src/features/tasks/taskUsage.ts
last_verified: 2026-10-07
---

# Agent context at session start

## Purpose
People cannot see which skill packs and knowledge a task had, and the agent often answers, pulls data or proposes a fix without reading the team's knowledge. This spec makes the skills a session loaded visible (including uploaded and granted skill packs), puts the project's knowledge map into the system prompt, makes a knowledge lookup the first step of any substantive request, and makes the `unslop` pass on the final reply a host rule instead of a line at the end of the orchestrator prompt. FR-7 to FR-9 close what T-1144 showed: a routine ran two knowledge searches, read no page and opened no `index.md`, and loaded only `unslop` although `monitoring`, `verification` and `tickets` fitted.

## Background (how it worked before)
- A run starts in `TaskRuntime.#run`, which builds SDK options in `#options` and calls `sdk.query`.
- Skill metadata (name and description) is injected by the Claude Agent SDK, not by NerveCenter: the plugin's skills come from `plugins: [{ type: 'local', path: pluginDir }]`, and custom or granted skills from `settingSources: ['project']`, which reads `<project>/.claude/skills/`. NerveCenter's appended prompt never listed them.
- `#handleMessage` recorded `session.init` with `skills` filtered to names starting `operations-fleet:`, so uploaded and granted skill packs never showed in the task page's "N skills available".
- Knowledge was never put in context. The appended prompt told the agent to read knowledge "before acting on anything that depends on them" and to search before "how do we / what counts as / who owns" questions; the orchestrator's fast path let it skip discovery. Data pulls and quick fixes usually fell through both.
- The unslop rule existed only as one line in `plugin/operations-fleet/agents/orchestrator.md`.

## Scope
- In scope: the `session.init` event's skill list, the knowledge map and knowledge-first rule in the appended system prompt, the unslop rule, the task page's skill count.
- In scope (FR-7 to FR-9): the knowledge fallback in the appended prompt, and two edits to the vendored plugin (the fast path in `agents/orchestrator.md` and the `monitoring` skill description), recorded in `plugin/SOURCE.md`. Drift from the upstream `ai_for_data` copy is accepted by the owner.
- Out of scope: retrieval quality of `search_knowledge` (SPEC-tasks-04), skill upload and grants (SPEC-skills-01, SPEC-projects-01), other plugin edits, reporting a skill the SDK did not load, the Knowledge tab badge, hiding built-in Claude Code skills from the agent.

## Requirements
- **FR-1** `session.init` SHALL record every skill the SDK reports that is either a plugin skill (`operations-fleet:*`) or a skill folder of the task's project (`.claude/skills/<name>`, own or granted, matched by folder name or frontmatter `name`), as `skills` (plugin) and `projectSkills` (project). Built-in Claude Code skills SHALL stay out.
- **FR-2** The task page's "Started" step SHALL count plugin and project skills together and list the project skill names.
- **FR-3** The appended system prompt SHALL include a "Knowledge map" section listing each knowledge base of the project (name, title, description, at most 40 bases, each line at most 200 characters) and the path of `knowledge/index.md`. It SHALL say "No knowledge bases are connected to this project" when there are none. The section SHALL be built from `listKnowledgeFolders()` once per run, so the prompt stays stable between messages and is cached.
- **FR-4** The appended system prompt SHALL state a knowledge-first rule that applies to every request except greetings, questions about the conversation itself, and quick questions about current state that one tool call answers (how many P1s are open, did last night's load run): before proposing or making a fix, pulling or querying data, changing anything, or answering how something works or who owns it, search knowledge for the subject, Read the matching pages, and cite their paths in the reply, or say in one line that no knowledge applies. The rule SHALL say it overrides the orchestrator's fast path for this step only.
- **FR-5** The appended system prompt SHALL state the unslop rule as a host rule: load the `operations-fleet:unslop` skill with the Skill tool once per session before the first reply, then apply it to every reply and to every piece of prose sent or published for a person. It SHALL not ask the agent to reload the skill on every reply.
- **FR-6** FR-3 to FR-5 SHALL apply whether or not NerveCenter's in-process tools are present; with them, the knowledge-first rule names `search_knowledge` (then `knowledge_catalog`); without them, it names `knowledge/index.md` and Grep.

- **FR-7** The knowledge-first rule SHALL say what to do when the search finds nothing relevant (no results, or only draft or off-topic pages): open `knowledge/index.md`, then the `index.md` of each base from the Knowledge map whose description fits, follow their links and Read the matching pages; only then say no knowledge applies, and name the indexes opened. It SHALL tell the agent to search the knowledge folder with `grep -R` or the Grep tool, never `grep -r`, because bases are symlinks into the library. It SHALL apply with and without the in-process tools (FR-6).
- **FR-8** The orchestrator and the `orchestrate` skill SHALL have no fast path: every request, a chat question, a routine, a scheduled task or any task that may change something, takes the fetch step (FR-10) and the discovery steps. (Replaces the earlier chat-only fast path, removed 2026-10-09.)
- **FR-10** The orchestrator SHALL start with a "Fetch first" paragraph that applies to every request, including a quick question: it SHALL say the agent must go through the relevant skill files and any knowledge the client has and must not rely on pre-trained knowledge alone; search the knowledge when there is any (the host lists bases or `knowledge/` exists) and Read the matching pages, opening `knowledge/index.md` and the likeliest base's index when the search finds nothing; read the skills list and load each skill whose description fits; then answer and say in one line which skills and knowledge were used, or that none applied.
- **FR-9** The `monitoring` skill's description SHALL also cover observing pipeline and run health when nothing has failed (checking or watching a pipeline's runs and health, observation routines), not only reviewing failures. No other skill description changes, and no host rule picks skills by task type.

## Scenarios
### S1 Uploaded skill pack is shown
- **Given** a project with a skill folder `sales-kpis` and an SDK init listing `operations-fleet:rca`, `sales-kpis` and a built-in skill
- **When** the run starts
- **Then** the `session.init` event has `skills: ['operations-fleet:rca']` and `projectSkills: ['sales-kpis']`, and the task page says "2 skills available".

### S2 Knowledge map in the prompt
- **Given** a project with knowledge bases `platform-runbooks` and `kpi-definitions`
- **When** the SDK options are built
- **Then** `systemPrompt.append` contains a Knowledge map section with both names and descriptions, the knowledge-first rule and the unslop rule.

### S3 No knowledge
- **Given** a project with no knowledge bases
- **When** the SDK options are built
- **Then** the Knowledge map section says no knowledge bases are connected.

### S4 Search misses
- **Given** a project with bases `team-knowledge` and `field-knowledge`, and a `search_knowledge` call that returns 0 results
- **When** the SDK options are built
- **Then** the prompt tells the agent to open `knowledge/index.md` and the index of each fitting base, to use `grep -R`, and to name the indexes it opened before saying no knowledge applies.

### S5 Observation routine can match monitoring
- **Given** a routine whose objective is to observe a pipeline's recent runs and create a ticket when a condition is breached
- **When** the SDK lists the plugin's skills
- **Then** the `monitoring` description names observing pipeline and run health, and the orchestrator sends the routine down the full path (FR-8).

## Interfaces
- Event `session.init`: adds `projectSkills: string[]`; `skills` keeps its meaning (plugin skills).
- No storage, schema or API change.

## Non-functional constraints
- The appended prompt stays identical across messages of a session unless knowledge bases change (prompt caching).
- The knowledge map adds at most about 2,000 tokens.
- Knowledge descriptions are written by project admins; they are listed as data, not instructions.

## Known gaps / deviations
- Whether the agent follows FR-4, FR-5 and FR-7 can only be checked from events (a `search_knowledge` or knowledge Read, and a `Skill` call for unslop); there is no hard gate.
- FR-10 is an instruction, not a gate. In the trigger eval (tools/skill-trigger-eval, neutral working folder) a generic "load the skills that fit" rule raised skill loading from 0/13 to at most 1/13 queries, so expect little change until something enforces it; it also adds a search and a skill load to quick questions, which costs time and tokens. The host prompt's own knowledge-first rule still lets quick one-call state questions skip the lookup, so the two texts disagree on that case.
- A description is a hint, not a gate: the agent may still skip `monitoring` or `verification`. If T-1144-style routines still skip them after FR-8 and FR-9, the next step is a host rule by task type, which needs its own FR.
- Unslop loaded once per session costs one Skill call per session; the agent may still drift late in long sessions.
- A granted skill is a symlink into the library; if the SDK does not follow it, the skill is silently absent from `projectSkills`.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/tasks/task-runtime.mjs` `#run`, `#handleMessage` | `backend/tests/agent-context.test.mjs` |
| FR-2 | `frontend/src/features/tasks/taskUsage.ts` | `frontend/src/features/tasks/taskUsage.test.ts` |
| FR-3 to FR-6 | `task-runtime.mjs` `#options`, `#nerveCenterContext` | `backend/tests/agent-context.test.mjs` |
| FR-7 | `task-runtime.mjs` `knowledgeLines` | `backend/tests/agent-context-rules.test.mjs` |
| FR-8 | `plugin/operations-fleet/agents/orchestrator.md` | Manual prompt review; a text assertion does not verify agent behavior |
| FR-9 | `plugin/operations-fleet/skills/monitoring/SKILL.md` | Manual skill review; a text assertion does not verify routing |
| FR-10 | `plugin/operations-fleet/agents/orchestrator.md` | Manual prompt review; a text assertion does not verify agent behavior |

## Open questions
- None. Decided 2026-10-07: quick state questions skip the knowledge lookup; a skill that did not load is not reported; the orchestrator and the `monitoring` description may drift from upstream; no task-to-skill mapping for now.
