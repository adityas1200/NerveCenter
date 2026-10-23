# Knowledge layer: build plan

Status: draft (20 Oct 2026). Design: [knowledge-layer.md](knowledge-layer.md). Storage decision: [ADR 0022](../adr/0022-knowledge-stays-okf-in-git.md).

Each slice is one feature branch off `zs-sandbox` and one PR back. Every slice with app behaviour starts with a draft spec, waits for approval, then builds with a test per FR.

## Where the code is today

| Need | Today | Gap |
|---|---|---|
| Shelves and page types | `knowledge-build/references/structure.md`: 9 shelves | No `business/`, `requests/` or `evals/`; no typed link fields; ticket audit has no legacy rule |
| Catalog | `knowledge_catalog` returns title, type, status, owner, tags, sections; cap 400 pages | Line-based frontmatter reader drops block lists; no link fields, filters or backlinks |
| Learning | Lesson capture fires only when a ticket closes | No capture of corrections in an ordinary chat |
| Stuck points | `get_task_log` signals: questions, rejections, interruptions, tool errors; `evaluate` labels pushback causes | Enough to derive them; nothing new to store |
| Evals | Plugin evals only | No `evals/` cases in a base, no runner, no per-journey score |
| Weekly pass | Routines are `workflows/<name>.yaml`, weekly supported | No default routines; no knowledge-pass skill |
| Documents | SharePoint connector (MCP); Confluence only as a custom MCP | No modified-date check against cited documents |
| Review | Drafts dialog, keep or discard, Git PR | Fine as is |

## Slices

### 0. Land the design (docs only)
Plan, ADR 0022 and the slide on `feature/knowledge-layer-plan`. You accept ADR 0022.

### 1. Structure (plugin only)
- `structure.md`: add `business/`, `requests/` and `evals/` with templates; typed link fields per type (`upstream`, `downstream`, `brands`, `stakeholders`, `vendor`, `refs`, `asked_by`, `uses`, `sla`, `tier`); the client ontology as a `sources/` entry.
- `ticket-audit.md`: the legacy rule for fixes made before a platform migration.
- `knowledge-extract`: the act on / look up / skip buckets for documents.
- `questions.md`: themes for brands and markets, stakeholders and tiers, request types, vendors.
- `plugin/SOURCE.md` entry; validator and plugin unit tests; update the interview-guide eval.

No app spec: this is the method, which SPEC-knowledge-03 leaves to the skill.

### 2. Catalog that reads links (backend, spec SPEC-knowledge-04)
- Parse frontmatter with the `yaml` package already in `backend/package.json`; old pages still read.
- Return the typed link fields per page.
- New optional filters: `type`, `field=value`, `linksTo` (backlinks). Same 400-page cap.
- Route and tool tests, including malformed frontmatter.

### 3. Teach moments (plugin plus one prompt line, spec SPEC-knowledge-05)
- The knowledge skill gets "Capture a correction": when a person corrects Sonic with a reusable fact, draft it once, citing the task and who said it.
- The system prompt names when to do it; `update_knowledge` accepts `sourceTask`.
- Stuck points are not stored: the weekly pass derives them from `get_task_log` signals and the `evaluate` pushback labels.

### 4. Knowledge evals (plugin plus backend, spec SPEC-knowledge-06)
- Case format in `evals/`: one Markdown file per case with `journey`, the question or ticket, the expected action, the pages it should cite.
- A `knowledge-eval` skill runs the cases with knowledge and read-only tools only, and writes a scorecard to the task.
- v1 has no UI; the score shows in the task and the weekly digest.

### 5. Weekly pass (plugin plus app, spec SPEC-knowledge-07)
- A `knowledge-pass` skill: the week's tasks via `list_tasks` and `get_task_log`, pushback labels, pages past `stale_after`, typed fields checked against live tools, changed cited documents, the evals, then one digest to the owner. Drafts only.
- "Turn on weekly knowledge pass" on the Knowledge page writes the routine file for the project (owner only).

### 6. Later, own spec
Autonomy per journey (permission policy), eval results on the Knowledge page, a built-in Confluence connector.

## Order

```text
0 ──┬── 1 structure ──┬── 4 evals ──┐
    ├── 2 catalog ────┤             ├── 5 weekly pass ── Helixa end to end
    └── 3 teach ──────┴─────────────┘
```

Slices 1, 2 and 3 touch different files and can run at the same time. Slice 4 needs the case format from 1. Slice 5 needs 2, 3 and 4. Run the Helixa journey after 3 (seed, interview, teach) and again after 5.

## Done means

- A new project gets the full shelves from setup, and Sonic fills typed links.
- A question like "pipeline A is late, who do I tell?" is answered by following links, with citations.
- A correction in chat becomes a draft within the same task.
- The weekly pass sends a digest with an eval score per journey, and nothing is kept without a person.
