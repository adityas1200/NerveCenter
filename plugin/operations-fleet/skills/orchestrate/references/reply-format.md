# Reply, approval, and report contract

This is the one place for the shape of a reply, how approval works, and where the write-up goes. The orchestrator and every skill point here; when a skill lists sections, they are the outline of the write-up file, not a required chat reply.

The reader should understand the result and know what to do within two minutes. Anything that does not help with that goes in the file.

## Size the reply to the request

| Request | Reply |
|---|---|
| Quick question or lookup about current state | The answer in a few lines, one small table, or one card. No headings, no plan, no file. |
| Investigation, RCA, change, data pull, report, or send | Headline, up to four short sections, and at most three next actions. About 350 words. Full detail in the write-up file. |
| Any of the above when the host draws components (cards, views) | The headline, then at most two short paragraphs, about 120 words: what it means and what is next. The components carry the evidence and the write-up file carries the sections; no headings or bulleted sections in chat, no list of knowledge or skills used, and no "above" or "below". |

## Shape of a full reply

1. **Headline.** One plain sentence with the outcome and its state: "The daily orders load failed because `region_cd` was renamed upstream; the fix is not yet verified."
2. **Sections.** Short noun headings (Impact, Evidence, Root cause, Timeline), or the chat headings a task skill names. Skip any section with nothing material in it. Lead each one with its conclusion, then the evidence.
3. **Confidence**, when the result is a judgement: high, medium, or low, plus the missing evidence that could change it.
4. **What to do next.** At most three actions. Each says who does it, what they do, and how anyone will know it worked.
5. **Files.** Link each file you created, with one short line on what it is for.

## One write-up file

Write at most one write-up per task:

- when the host renders artifacts, a self-contained HTML report shown with `show_artifact` (see [HTML report](html-report.md));
- otherwise, or when the work has no report worth drawing, `report.md`.

Never both. Data that belongs in its own file (a CSV, the query, a profile) is linked from the write-up, not repeated in it.

The write-up holds what the reply leaves out: the full section list a skill defines, the timeline, raw evidence, query text, long tables, alternatives ruled out, the knowledge consulted, and method notes. Mention knowledge in the reply only when it changed the decision or conflicted with live evidence.

## Say the specific thing

Name the real asset, not its category: "6 source systems (CRM, ERP, billing, web events, and two vendor feeds)", not "several source systems"; "87% schema coverage", not "most fields mapped". A claim with a number and a name is checkable; a claim with neither is filler, and filler is what gets cut.

## Approvals and writes

Before any material write, state the exact target and the change in one sentence. When the change cascades beyond one object, add the cascade as a short list. What happens next depends on the permission the host gives the task:

| Permission | What to do |
|---|---|
| Read-only | Do not write. Say exactly what you would do. |
| Pre-approved (`allow`) | State the target and change, then proceed. Do not ask again. |
| Approval-gated by the host (`ask`, or a policy category that pauses) | State the target and change, then make the call. The host's approval prompt is the confirmation; do not also ask in chat. |
| No host gate, and `operations.yaml` policy says `ask` | Ask in chat and wait for a clear yes before the write. |
| Denied | Stop. Say what is blocked and who can approve it. |

- Each write needs its own authority. Approval of the original change does not cover a clone, a cleanup, an email, or a ticket update.
- In an unattended run (a routine or schedule), never stop to ask in chat. Let the host's approval gate pause the write, or report what the run would have done.
- After the write, read the authoritative state back. When the result is ambiguous, inspect current state before retrying.

Example of a change with a cascade:

> I'll rename `region_cd` to `region_code`. This cascades to:
> - the staging DDL for `stg_orders`
> - 2 downstream mappings
> - the null-check rule on this column

## When something failed

State the fix as a numbered plan, not a paragraph: what you will re-check, what you will change, how you will confirm it worked. Three steps at most; if it takes more, put the rest in the file.

## Show, do not narrate

Use a visual when it replaces a paragraph:

| Content | Form |
|---|---|
| Cause and effect, or a dependency chain | Flowchart, trigger to impact, at most 8 nodes |
| Events over time | Timeline with absolute timestamps and timezone |
| Lineage or blast radius | Graph from upstream source to downstream consumers |
| Comparison of runs, options, or periods | Table with the difference in its own column |
| Trend or distribution | Chart image saved as a file |
| Status of several items | Table with one status word per row |

When the host offers display tools (its own `show_*` components), prefer them over markdown. The host lists the ones it has; use the one that fits the shape of the content:

| Content | Component |
|---|---|
| Headline numbers (one to four) | `show_metrics` (with `trend` when the recent values matter) |
| Label and value pairs (owner, schedule, SLA) | `show_facts` |
| A status list, or anything over five rows | `show_table` |
| Numbers over time or by category | `show_chart` |
| The parts of one whole (failures by cause, cost by job) | `show_chart` with type `donut` |
| A number across two dimensions (failures by hour and weekday, null rate by column and day) | `show_heatmap` |
| A measure against a target or limit (SLA met, freshness against its limit, budget used) | `show_gauges` |
| Counts falling through stages (rows landed, valid, loaded, published) | `show_funnel` |
| Runs or jobs on one time axis (overlaps, durations, an SLA deadline) | `show_gantt` |
| Items by period or check, one state each (runs per day, checks per run) | `show_status_grid` |
| Events in order | `show_timeline` |
| The steps of one run with durations | `show_progress` |
| Stages in a line and where it broke | `show_flow` |
| Before and after values | `show_comparison` |
| Two lists aligned (contract columns against file columns) | `show_set_diff` |
| Lineage or blast radius | `show_lineage` |
| Checks with evidence and a result | `show_checklist` |
| Records changed in another system, read back | `show_records` |
| A diff, or a pull request | `show_change`, `show_pull_request` |
| An email to send | `show_email` (the person edits it; sending still asks for approval) |
| A document, deck or workbook written to the task folder | `show_document`, or `show_artifact` for an HTML report |
| A ticket, or a pipeline's recent runs, as the system has them | `show_ticket`, `show_pipeline_runs` (the host reads the data) |
| What is worth knowing, risks, caveats | `show_notes` |
| A stakeholder summary of several of these | `show_view` (1 to 12 blocks, full or half width) |

Steering components, when the host has them: `set_outcome` whenever the task's state changes (one-line headline the reader sees under the title); `explain_action` right before a write that may need approval (what happens, checks, impact, how to undo); `show_actions` to end a turn that leaves work for the person (next steps they can click, and up to three follow-up questions); `request_input` when you need several values at once (dates, a choice of tables) instead of asking in prose. A component already shown does not need repeating in the reply; refer to it in one clause.

Draw diagrams as Mermaid when the host renders it. Documents and email cannot render Mermaid, so give them an image or an HTML table instead. Label every node and axis with the real asset, run, or metric name. Leave out a diagram that only repeats the text.

A Mermaid diagram that fails to parse shows as a plain error, not the diagram - so get the syntax right the first time:
- Quote any node or edge label that contains punctuation (`:` `,` `(` `)` `|` `/`) or a space: `A["Reason: cost (high)"]`, not `A[Reason: cost (high)]`.
- Never use the bare word `end` (any case) as a node id or an unquoted label - Mermaid reads it as closing a block and the diagram breaks. Quote it (`"End"`) or use a different word (`Finish`, `Done`).
- Declare the diagram type on the first line (`flowchart TD`, `sequenceDiagram`, …) and use plain straight quotes `"` - a smart/curly quote from a pasted source breaks the parser.
- In a `timeline`, `:` separates a period from its events, so a clock time breaks the parse (`2026-09-30 10:34 : Run timed out` fails). Write the time without a colon (`10.34`) or put it after the separator (`2026-09-30 : 10.34 UTC - Run timed out`). Do not use `#` or `;` in a timeline period either.
- Keep labels plain text; Mermaid does not render Markdown inside a label, so `**bold**` or backticks show up as literal asterisks and backticks, not formatting.
- When unsure, prefer the simplest diagram that says it (a short `flowchart TD`) over a more elaborate type whose syntax you are less sure of.

## Cut

- restating the request, or narrating the steps you took ("First I checked...");
- generic caveats, best-practice lectures, and generic offers of more help ("let me know if you need anything else");
- the same fact given in two sections;
- tables with a single row or a single column;
- bold used for anything other than a status word or a number the reader must see.

A named, answerable follow-up is not filler and is not cut: "Want the SQL that reproduces this?" or "Should I also check the two other pipelines on this source?" names a specific next question the reader can say yes to in one word.

Then apply the `unslop` skill to the prose.
