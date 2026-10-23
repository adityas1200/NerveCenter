# Vendored plugin

`operations-fleet/` is a vendored copy of the Operations Fleet Claude Code plugin from
`zs_businesstech/ai_for_data` (Bitbucket), snapshot `38bbcda00ead`, taken 23 Sep 2026.

Removed from the copy because they are authoring tools, not runtime:
`skill-builder/` (nested plugin), `skill-authoring-guide/` (HTML docs),
`examples/client-workspace/configs/` (test credentials file).

Local additions after the snapshot: `skills/unslop/` (Lauren Tan's MIT-licensed rules from
`cursor/plugins` pstack, commit `12d587d`, plus an operations scope section), its eval, and the
one-line hooks that apply it in `agents/orchestrator.md`, `communication` and `documents`.

Validate after any change:

    python plugin/operations-fleet/tools/validate_plugin.py
    python -m unittest discover -s plugin/operations-fleet/tests

## Local changes, 3 Oct 2026

Skills refresh after the Sonic skills audit. Skills stay generic; anything
client-specific belongs in the client's knowledge.

- Host-tool blocks ("When the host offers ...") in monitoring, tickets, rca, knowledge, workflow,
  verification, build, remediation, data-pull, communication, and the orchestrator agent, routing
  to the host's own tools (pipelines, runs, DQ results, query_data, ticket tools that write through
  to the source system, record_finding, show_lineage, show_change, show_pull_request,
  search_knowledge / knowledge_catalog / update_knowledge, save_routine / run_routine).
- Ticket-change email is opt-in: the "notification contract" is gone from tickets, communication,
  orchestrate, and their references. Email only when asked or when operations.yaml or knowledge
  says ticket changes are announced.
- One reply, approval, and write-up contract in `skills/orchestrate/references/reply-format.md`:
  no "confirm even under allow"; a host approval gate is the confirmation; one write-up file
  (HTML report or report.md); RCA's full sections go in the file. Orchestrator and orchestrate
  skill gain a fast path for simple factual questions.
- rca: `references/infrastructure.md` (compute and infrastructure causes from platform APIs and
  system tables).
- remediation: removed the claim about backend clone adapters; clone-first validation now uses the
  platform's native zero-copy or shallow clone.
- build: `references/bitbucket.md` (Cloud REST 2.0 and Data Center); SKILL.md picks the reference
  by `source_control.platform`; tokens from the environment, never in remote URLs.
- workflow: `uses` lists connection names only; example fixed.
- setup: host-neutral (no `.mcp.json` or `/mcp` when the host manages connections);
  `check_workspace.py` accepts `smtp` connections, host sections (`agent`, `sync`, `connectors`,
  `ui`), `branding`, and `policy.rules`, and warns on unenforced policy keys and on workflow `uses`
  that are not connections; template policy keys match the host's categories, plus optional
  `branding` and `communication.internal_domains`.
- documents: lists the installed libraries and the workspace `templates/` folder; dropped links to
  document skills that are not shipped.
- Demo-client names removed from shared skill text, examples, and two eval prompts.
- New skills `ask-data` and `lineage-impact`, each with one eval case; validator expects 19 skills.
- Tests: stale orchestrate assertion replaced; `python3` subprocess calls use `sys.executable`;
  new checks for the reply contract, opt-in email, and the workspace checker.

## Local changes, 4 Oct 2026

Learning from similar past tickets (host tools `find_similar_tickets` and `link_related_ticket`).

- rca and remediation: "When the host offers `find_similar_tickets`" block. Search similar resolved
  tickets early; treat a past fix as a hypothesis and verify it against current evidence with
  `record_finding`, never apply it blindly; when a past fix proved insufficient, link with
  `amends_fix_of`, comment on the earlier ticket, and capture the amended fix in the knowledge
  skill's lesson capture. Remediation also offers, after resolving a ticket whose fix amended a past
  fix, a review of other tickets with the same fix pattern or signature (`AskUserQuestion`), framed
  by fix pattern and never by person.
- knowledge and `references/lesson-capture.md`: an amended fix is added to the existing
  failure-pattern concept as "fix v1 ... amended because ...".
- tickets: one paragraph naming the two new host tools.

## Local changes, 7 Oct 2026

Learning from task T-1144 (a routine skipped knowledge and every skill but unslop), SPEC-tasks-08 FR-8 and FR-9. The
owner accepts that these two files now differ from upstream `ai_for_data`; keep ours when syncing.

- orchestrator: the fast path covers only a question a person asks in chat, and a routine, a scheduled task, or any
  task that reads state and may then change something takes the full path.
- monitoring: the description also covers observing pipeline and run health when nothing has failed, so observation
  routines match it.

## Local changes, 8 Oct 2026

SPEC-tasks-08 FR-10. Same drift note as 7 Oct: keep ours when syncing with upstream `ai_for_data`.

- orchestrator: a "Fetch first" paragraph at the top. For every request, including a quick question, search knowledge
  (when there is any) and read what matches, read the skills list and load the skills that fit, then answer and say
  in one line what was used. The fast path no longer skips this step.

## Local changes, 9 Oct 2026

SPEC-tasks-08 FR-8 (revised) and FR-10. Same drift note: keep ours when syncing with upstream `ai_for_data`.

- orchestrator: the "Fast path" paragraph is removed; every request takes the discovery steps. The "Fetch first"
  paragraph now says the agent must go through the relevant skill files and any knowledge, and must not rely on
  pre-trained knowledge alone.
- orchestrate skill: the "Fast path" section and the "not needed for a simple factual question" sentence in its
  description are removed.

## Local changes, 11 Oct 2026

- `skills/orchestrate/references/reply-format.md`: "Show, do not narrate" maps content shapes to the
  host's component catalog (NerveCenter SPEC-tasks-10 FR-23): charts, facts, status grids, progress,
  flows, set diffs, checklists, records, email drafts, documents, notes, data-bound ticket and run
  cards, composed views, and the steering components (`set_outcome`, `explain_action`,
  `show_actions`, `request_input`). Generic: it names only what the host offers.
- `skills/orchestrate/references/reply-format.md`: a reply-size row for hosts that draw components: the
  headline plus at most two short paragraphs, with the sections in the write-up file (NerveCenter
  SPEC-tasks-10 FR-6).
- `skills/orchestrate/references/reply-format.md`: rows for the richer visualisations (donut chart,
  heatmap, gauges, funnel, gantt, metric trends) so skills pick them by the shape of the content
  (NerveCenter SPEC-tasks-10 FR-25).

## Local changes, 13 Oct 2026

NerveCenter SPEC-knowledge-03 (knowledge setup). Same drift note: keep ours when syncing with upstream `ai_for_data`.

- New skill `knowledge-build`: build a project's knowledge at onboarding. Discover from attached documents, connected
  systems and past ticket exports; draft into a fixed set of shelves (`references/structure.md`); audit resolved
  tickets by problem group (`references/ticket-audit.md`); turn gaps into confirm-or-correct and evidence-anchored
  interview questions (`references/questions.md`); fold meeting transcripts back in with cited drafts and question
  status (`references/transcripts.md`). Uses the host's `update_interview_guide` when offered, otherwise an
  `interview-guide.md` table in the task folder. One eval case, `knowledge-build-interview-guide`; validator
  expects 20 skills.

NerveCenter SPEC-tasks-13 (tested fixes). Same drift note.

- `skills/remediation/references/clone-first-validation.md`: a "When the host offers tested-fix tools" section: copy,
  change and test only the copy, propose with the exact statement and checks, explain, apply by proposal id, read the
  host's verification, and never fall back to raw SQL through a shell when the tools and a sandbox exist. Generic:
  it names the tools only as examples of what a host may offer.
- `skills/remediation/SKILL.md`: one sentence pointing clone-first validation at those tools when offered.

## Local changes, 16 Oct 2026

NerveCenter SPEC-tasks-04 FR-12 and FR-13 (reading past tasks for review). Same drift note.

- New skill `evaluate`: grade past agent tasks from their full logs for a scheduled quality review. Mechanical checks
  first, then judgement dimensions with 1/3/5 anchors (`references/rubric.md`), a cause label for every pushback so
  back-and-forth alone is no penalty, later outcomes over the conversation, a second look on low or disputed scores,
  and a fixed report shape (`references/scorecard.md`). No quote, no score; read-only. Uses the host's `list_tasks`
  `since` and `get_task_log` when offered. One eval case, `evaluate-friction-and-numbers`; validator expects 21
  skills.

## Local changes, 20 Oct 2026

NerveCenter SPEC-knowledge-04 to 07 and ADR 0022 (knowledge layer: typed links, teach moments, evals, weekly pass).
Same drift note: keep ours when syncing with upstream `ai_for_data`.

- `skills/knowledge-build/references/structure.md`: shelves `business/` (brands, markets, stakeholders, vendors),
  `requests/` (usual asks translated to data) and `evals/` (cases per journey); "Live truth is read, not copied"
  (catalog and ontology read live, legacy history marked `era: legacy`); the typed link and scalar fields; templates
  for brand, stakeholder, vendor, request and eval case.
- `skills/knowledge-build/references/ticket-audit.md`: split history at a migration cut-over; count who asks; draft up
  to 10 eval cases per top journey.
- `skills/knowledge-build/references/questions.md`: themes no system holds (business map, who asks, SLAs, vendors,
  vague asks, legacy).
- `skills/knowledge-build/SKILL.md`: typed fields, live catalog by `refs`, eval cases; the self-check runs
  `knowledge-eval`.
- `skills/knowledge-extract/SKILL.md`: act on / look up / skip buckets, so live facts are pointed at, not copied.
- `skills/knowledge/SKILL.md`: catalog filters and `fields` on `update_knowledge`; new "Capture a correction" section
  (save what a person teaches with `origin: correction` and `taughtBy`, skip one-off preferences, flag conflicts).
- New skill `knowledge-eval`: answer kept eval cases blind in fresh subagents, grade with a fixed rubric, record one
  run per journey through the host (which computes the score). Eval case `knowledge-eval-blind-grading`.
- New skill `knowledge-pass`: the weekly pass over the week's task logs, drafts, stale pages, field drift, changed
  sources and evals, ending in one digest; drafts only, never keeps or discards. Eval case `knowledge-pass-digest`.
- Eval case `knowledge-correction-capture` for the knowledge skill. Validator expects 23 skills.
