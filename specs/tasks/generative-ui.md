---
id: SPEC-tasks-10
title: One-thread task page and Sonic's component catalog (generative UI)
status: implemented
area: tasks
owners: [mitesh.shinde]
code:
  - backend/src/tasks/ui-catalog.mjs
  - backend/src/tasks/nervecenter-tools.mts
  - backend/src/tasks/nervecenter-tool-categories.mjs
  - backend/src/tasks/task-runtime.mts
  - frontend/src/features/tasks/TaskPage.tsx
  - frontend/src/features/tasks/TaskThread.tsx
  - frontend/src/features/tasks/taskEvents.ts
  - frontend/src/features/tasks/QuestionPrompt.tsx
  - frontend/src/features/tasks/OutcomeLine.tsx
  - frontend/src/features/tasks/outcome.ts
  - frontend/src/components/ops/AgentPanel.tsx
  - frontend/src/features/inbox/InboxPage.tsx
  - frontend/src/features/tasks/cards/
  - plugin/operations-fleet/skills/orchestrate/references/reply-format.md
last_verified: 2026-10-11
---

# One-thread task page and Sonic's component catalog

## Purpose
The task page had four views of one piece of work (Result, Journey, Investigation, Conversation), a phase strip and a seven-tab rail, and readers could not tell where to look. Sonic's answers were markdown plus a few read-only cards. This spec makes the task one conversation: Sonic answers with components chosen from a catalog (charts, status grids, flows, checklists, records, email drafts, forms, composed views), people act from those components, and a single line under the title says where the work stands. Research and mock: `docs/research/generative-ui.md`, `docs/mockup-task/`. Technical decisions: ADR 0009.

## Scope
- In scope: the task page layout, the thread, the component catalog (backend tools and frontend renderers), actions on components, the input form, plain-language approvals, the outcome line, the Details sheet, the agent's prompt and the plugin's reply format.
- Out of scope: one approval covering several writes (a permission-model change), agent-written interactive HTML (HTML artifacts stay scriptless, SPEC-tasks-06 NFR), saving a composed view as a board, rendering components in Slack or email.

## Actors and permissions
- Every component tool is category `read`: it changes nothing and never asks for approval.
- Actions on components never write. `ask` sends a message as the reader (the same as typing it); any write Sonic then makes goes through the permission gate (SPEC-tasks-03). Viewers cannot send messages, so `ask` actions are disabled for them.
- Data-bound components read through `operationsService` with the task creator's project role, like every other nervecenter read.

## Requirements

### Task page
- **FR-1** The task page SHALL show one conversation and no view tabs: no Result, Journey, Investigation or Conversation tab, no phase strip. The task's details sit beside it in a side panel (FR-3).
- **FR-2** Under the header the page SHALL show the outcome line. It holds the state and headline from the latest `set_outcome` call and up to five items (label, value, tone). Without one it SHALL fall back to the task's status, its ticket or routine, the number of changes and the time taken. While the task runs the line SHALL say what Sonic is doing now; while it waits on the reader it SHALL say "Waiting for your approval" or "Waiting for your answer", and clicking it SHALL scroll to the prompt.
- **FR-3** The task's files, changes, skills, knowledge, ticket or routine context and session facts (cost for admins only) SHALL be tabs on an icon strip beside the thread on screens 768px and wider, each opening a panel; the open tab again, Hide, or the header's Details button folds the panel to the strip, and whether it is open is remembered. A tab SHALL show a dot while it holds something not yet looked at. On narrower screens the Details button SHALL open a sheet with the same sections stacked. Selecting an entry that points at a step SHALL scroll the thread to it (closing the sheet). *Amended 2026-10-12: the side panel is back; the owner preferred it to a sheet on desktop.*
- **FR-4** For a finished task the page SHALL open at the top of the thread; for a live or waiting task it SHALL stick to the bottom.
- **FR-5** Questions Sonic suggests (`show_actions.questions` of the last turn) SHALL show as chips above the composer when the task is not live; clicking one sends it.

### Thread
- **FR-6** Each Sonic turn SHALL read: the fold ("Worked for 2m", with the systems it touched), then the components it drew, in order, then its reply. Steps, commentary, reads and auto-approved writes stay in the fold. Once a turn that drew components (cards, findings or an approval) is finished, the reply's first sentence SHALL show as the turn's headline between the fold and the components, and the rest of the reply below them; a reply that opens with a heading, list, table, quote or code block, or a first sentence under 12 or over 320 characters, stays whole at the end. A live turn and a turn that drew nothing keep the reply whole at the end. The prompt SHALL tell Sonic to open every final reply with the answer in one plain sentence.
- **FR-7** A pending approval SHALL render as a card in the turn, outside the fold, and the fold SHALL not open on its own for it. When the approval follows an `explain_action` call in the same turn, the card SHALL show that explanation (title, what happens, checks, impact, rollback, what if it fails) labelled as Sonic's summary, the policy category from the server, and the exact command or input behind "Show command". Without an explanation it SHALL show the command or input as before (SPEC-tasks-06 FR-12).
- **FR-8** A decided approval with an explanation SHALL stay in view as the explanation with its decision ("Approved by <name>", "Denied by <name>"); one without an explanation stays in the fold.
- **FR-9** `record_finding` calls in a turn SHALL render as one investigation card at the place of the turn's first finding: hypotheses with their evidence and ruled-out causes, the root cause with confidence, the fix and its verification.
- **FR-10** While Sonic is starting a component tool (the `tool start` delta), the turn SHALL show a skeleton card naming the component until the call lands.
- **FR-11** The compact agent panel (SPEC-tasks-07) SHALL render the same components in their compact form.

### Component catalog
- **FR-12** The catalog SHALL be defined once in `backend/src/tasks/ui-catalog.mjs`: each component has a kind, a description and a zod shape. The `show_*` tools, the `show_view` block union and the catalog lines in the agent prompt SHALL be generated from it, so a component added there is offered, validated and explained to Sonic without other backend edits.
- **FR-13** The catalog SHALL offer these components (existing ones keep their inputs):
  - Data: `show_table`, `show_metrics`, `show_chart` (column, bar, line or area; up to 6 series; stacked or grouped), `show_facts` (label and value pairs).
  - Status and time: `show_status_grid` (rows by columns of states, such as runs per day or checks per run), `show_timeline`, `show_progress` (the steps of a run with state and duration), `show_flow` (stages in a line with a state each: where it broke and what is stale).
  - Investigation and change: `show_comparison`, `show_set_diff` (two lists aligned, such as contract columns against file columns, with added and missing items marked), `show_lineage`, `show_change`, `show_pull_request`, `show_checklist` (checks with evidence and a result: pass, fail, open, skipped or info), `show_records` (records changed in other systems: from state, to state, read back or not).
  - Communication and documents: `show_email` (a draft the reader can edit before asking Sonic to send it), `show_document` (a file in the task folder with its outline), `show_notes` (short titled notes with a tone: what is worth knowing, risks, caveats), `show_artifact`.
  - Steering: `propose_plan`, `update_plan`, `record_finding`, `show_actions`, `set_outcome`, `explain_action`, `request_input`.
  - Composition: `show_view` lays out 1 to 12 blocks of the kinds above (except the steering, artifact and data-bound ones) as one titled view, each block full or half width.
- **FR-14** Data-bound components SHALL fetch what they show on the server: `show_ticket` (a ticket by id) and `show_pipeline_runs` (a pipeline's recent runs). The tool result carries the data, the UI SHALL render from the result, not from the model's input, and an id from another project SHALL read as missing.
- **FR-15** Every component tool SHALL be category `read` in `TOOL_CATEGORIES`; the catalog SHALL refuse at start-up a component without a category.
- **FR-16** The frontend SHALL render each kind with a parser that tolerates partial or wrong input (drops bad rows, caps lengths, defaults states). A kind the frontend does not know, inside a view or on its own, SHALL render as a plain card of its title and fields instead of nothing or an error.
- **FR-17** Colours SHALL come from the theme tokens and the status families; charts SHALL use the shared chart components (`components/ops/charts`); no component may run agent-written script or HTML.

### Actions and input
- **FR-18** `show_actions` items SHALL be one of: `ask` (sends `prompt` as the reader's message), `open` (an app route starting with `/`, a file in the task folder, or an `https://` link opened in a new tab with `rel="noreferrer"`). Items marked `needsApproval` SHALL say so. An `ask` action SHALL be disabled while the task is live, waiting or stopped, and for viewers.
- **FR-19** The email card SHALL let the reader edit recipients, subject and body; "Send" SHALL send a message asking Sonic to send exactly the edited email. Sending then goes through the approval gate like any email.
- **FR-20** `request_input` SHALL pause the task with a form (1 to 8 fields: text, textarea, number, date, email, select, multiselect, boolean; each with label, required, options, placeholder) shown in the thread and the Inbox as a question item. The answers SHALL go back as the tool's result `{ answers }`, keyed by field label; declining SHALL tell Sonic to continue without them.
- **FR-21** Checklist items and status-grid cells MAY carry an `ask` prompt; clicking one SHALL behave like an `ask` action.

### Agent guidance
- **FR-22** The agent prompt SHALL tell Sonic: answer with components, not prose, when the content is data; call `set_outcome` when a task's state changes; call `explain_action` right before any write that may need approval; end a turn that leaves work for the reader with `show_actions`; use `show_view` for a stakeholder summary of several components; keep markdown for explanation.
- **FR-24** Nothing a reader sees SHALL be plumbing (from the live runs of 11 Oct):
  - A shell step reads as the command's own description, or the command without its `cd <dir> &&` prefix and with absolute paths cut to their last two parts.
  - Tool loading reads "Loaded tools".
  - The phase divider names the first skill doing the work, never `unslop` or `orchestrate`.
  - The outcome line keeps at least two fifths of its width for the headline and shows at most three facts, each only when it reads whole.
  - Suggested questions sit on one row that scrolls sideways.
  - Next steps (`show_actions`) close the turn, after the reply.
  - The rest of a reply over 700 characters under components opens on its first lines with "Show the full reply".
  - A root cause is drawn once with its chips, not again under the confirmed hypothesis.
  - An email body is plain text: markdown emphasis, headings and dash bullets are dropped.
  - A note's run-in title ends with a full stop.
  - A metric's wordy sub-line is a plain note; only a delta is a chip.
  - Table columns are sized by their content.
  - The prompt and the reply format SHALL cap the reply under components at the headline plus two short paragraphs, without headings, without listing knowledge or skills used, and without "above" or "below"; a stakeholder summary SHALL start with a `show_view`.
- **FR-25** The catalog SHALL also offer richer visualisations, each in a view as well as on its own:
  - `show_heatmap`: a number across two dimensions as cells shaded in one hue, five steps light to dark. `scale` picks red (high is bad), green (high is good) or the brand. Zero reads as empty and no data as a dashed cell; a legend gives the range.
  - `show_gauges`: one to four rings, each a measure against its max with a target tick. The colour comes from the value against the target and its direction, and is said in words (On target, Near target, Off target).
  - `show_funnel`: two to eight stages with what each lost, in count and percent, and the share that reached the end.
  - `show_gantt`: up to 12 lanes and 60 bars on one UTC time axis with round-time ticks. Overlapping bars stack, running bars pulse, and up to four markers draw dashed lines (an SLA deadline). A bar with `ask` asks Sonic about itself.
  - `show_chart` type `donut`: the parts of one whole.
  - `show_metrics` items MAY carry a `trend`, drawn as a sparkline in the tile.
  Every mark SHALL be named on hover and to assistive technology, and colour never carries the meaning alone.
- **FR-23** The plugin's reply format (`skills/orchestrate/references/reply-format.md`) SHALL map content shapes to these components, and the change SHALL be recorded in `plugin/SOURCE.md`.

## Scenarios

### S1 One conversation
- **Given** a finished ticket task with a reply, cards and findings
- **When** the reader opens it
- **Then** there are no view tabs; the details are in the side panel; the outcome line shows its state; the thread shows each turn's fold, the investigation card, the cards and the reply.

### S2 Plain-language approval
- **Given** Sonic called `explain_action` and then a write that needs approval
- **When** the task waits
- **Then** the turn shows the explanation with Approve and Deny, the policy category and "Show command"; the outcome line reads "Waiting for your approval".

### S3 Action from a component
- **Given** a finished task whose last turn has `show_actions` with an `ask` item
- **When** the reader clicks it
- **Then** its prompt is sent as the reader's message and the task runs again.

### S4 Composed view
- **Given** Sonic calls `show_view` with metrics, a chart, a status grid and a checklist
- **Then** they render as one titled view in that order; an unknown block kind renders as a plain card.

### S5 Data-bound runs
- **Given** Sonic calls `show_pipeline_runs` for a pipeline of the task's project
- **Then** the result carries the runs from the run store and the card renders them; for a pipeline of another project the call fails with "No runs of pipeline … in this project".

### S6 Form
- **Given** Sonic calls `request_input` with a date and a select field
- **When** the reader fills and sends the form
- **Then** the tool returns the answers keyed by label and Sonic continues.

## Interfaces
- Tools (nervecenter MCP server): the catalog in FR-13, FR-14, FR-20. Shapes live in `ui-catalog.mjs`.
- Events: unchanged types. `question.asked` MAY carry `form: true` and `reason` for a `request_input` form, and its questions `field {type, required, placeholder}`; the Inbox item keeps the same questions. `answers` stay `Record<string, string>` (multiselect joined with ", "); a form sends only the fields filled in.
- UI: `/tasks/:taskId` (one thread, outcome line, details side panel, Details sheet on a phone), the agent panel, the Inbox question item.

## Non-functional constraints
- No new dependency. Components are data rendered by React; nothing from the model is set as HTML except mermaid in markdown (unchanged).
- Each component tool result stays under 20 KB so the SDK never spills it to a file.
- Streaming text keeps `aria-live="polite"` on the draft only; components announce nothing while streaming.
- Motion stays 200–300 ms ease-out; no loops except the live-state dot.

## Known gaps / deviations
- One approval still covers one write; a change card cannot approve a group of steps (out of scope).
- `show_view` cannot hold data-bound blocks; Sonic shows them on their own.
- Partial tool input is not parsed for progressive rendering; the skeleton shows until the call lands (FR-10).
- An explanation pairs with the next approval in its turn; if the write it explained needed no approval, the explanation is not shown.
- An older task's HTML file that Sonic never showed with `show_artifact` is no longer framed; it is listed in the Details sheet.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-3, FR-4 | `frontend/src/features/tasks/TaskPage.tsx`, `useStickToBottom.ts` | `frontend/src/features/tasks/TasksPages.test.tsx`, `taskDetails.test.tsx`, `artifacts.test.tsx` |
| FR-2 | `frontend/src/features/tasks/OutcomeLine.tsx`, `outcome.ts` | `frontend/src/features/tasks/outcome.test.ts`, `TasksPages.test.tsx` |
| FR-5, FR-18, FR-21 | `cards/ActionsCard.tsx`, `cards/DataBlocks.tsx`, `cards/taskActions.ts`, `TaskPage.tsx` | `frontend/src/features/tasks/catalog.test.tsx`, `taskDetails.test.tsx` |
| FR-6, FR-7, FR-8 | `TaskThread.tsx`, `turnHeadline.ts`, `taskEvents.ts`, `cards/ExplainedApproval.tsx`, `task-runtime.mjs` (prompt) | `frontend/src/features/tasks/thread.test.tsx`, `turnHeadline.test.ts`, `TasksPages.test.tsx`, `backend/tests/ui-catalog.test.mjs` |
| FR-9 | `cards/InvestigationCard.tsx` | `frontend/src/features/tasks/thread.test.tsx` |
| FR-10, FR-11 | `TaskThread.tsx`, `components/ops/AgentPanel.tsx` | `frontend/src/features/tasks/thread.test.tsx` |
| FR-12, FR-13, FR-15 | `backend/src/tasks/ui-catalog.mjs`, `nervecenter-tool-categories.mjs` | `backend/tests/ui-catalog.test.mjs` |
| FR-14 | `backend/src/tasks/nervecenter-tools.mts`, `cards/BoundCards.tsx` | `backend/tests/ui-catalog.test.mjs`, `frontend/src/features/tasks/catalog.test.tsx` |
| FR-16, FR-17 | `frontend/src/features/tasks/cards/blocks.ts`, `cards/BlockCard.tsx`, `cards/DataBlocks.tsx` | `frontend/src/features/tasks/catalog.test.tsx` |
| FR-19 | `cards/EmailCard.tsx` | `frontend/src/features/tasks/catalog.test.tsx` |
| FR-20 | `backend/src/tasks/task-runtime.mts`, `QuestionPrompt.tsx`, `features/inbox/InboxPage.tsx` | `backend/tests/request-input.test.mjs`, `frontend/src/features/tasks/QuestionPrompt.test.tsx` |
| FR-22 | `backend/src/tasks/task-runtime.mts`, `ui-catalog.mjs` | `backend/tests/ui-catalog.test.mjs` |
| FR-23 | `plugin/operations-fleet/skills/orchestrate/references/reply-format.md` | `python plugin/operations-fleet/tools/validate_plugin.py` |
| FR-25 | `backend/src/tasks/ui-catalog.mjs`, `cards/VizBlocks.tsx`, `cards/blocks.ts`, `cards/DataBlocks.tsx`, `cards/MetricsCard.tsx`, `components/ops/StatStrip.tsx` | `backend/tests/ui-catalog-viz.test.mjs`, `frontend/src/features/tasks/viz.test.tsx` |
| FR-24 | `TaskThread.tsx`, `tools.ts`, `OutcomeLine.tsx`, `TaskPage.tsx`, `investigation.ts`, `cards/blocks.ts`, `cards/DataBlocks.tsx`, `cards/MetricsCard.tsx`, `cards/TableCard.tsx`, `task-runtime.mjs` | `frontend/src/features/tasks/polish.test.tsx`, `backend/tests/ui-catalog.test.mjs` |

## Open questions
- Should Sonic pick a stakeholder or engineer layout from the viewer's role, or always from the request?
- Should a composed view be savable as a board?
