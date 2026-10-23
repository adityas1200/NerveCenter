# Knowledge layer: what Sonic knows, how it gets there, how it gets better

Status: draft for review (20 Oct 2026). Builds on [SPEC-knowledge-01](../../specs/knowledge/knowledge-bases.md), [SPEC-knowledge-03](../../specs/knowledge/knowledge-setup.md) and [knowledge-builder](knowledge-builder.md). Storage decision: [ADR 0022](../adr/0022-knowledge-stays-okf-in-git.md). Input: the 19 Oct design call with Mayank and Ashutosh.

## The bet

Sonic's accuracy on a client is the quality of that client's knowledge. Storage is not the hard part; getting the right facts, in a shape an agent can follow, and keeping them true, is. So the layer stays plain: OKF Markdown in Git, one concept per file, typed links in frontmatter, reviewed by people through drafts and PRs. Everything below is about content, shape and the loop, not a new store.

Knowledge is decoupled from NerveCenter. A base is a Git repo the client owns; NerveCenter reads it and drafts into it, but never holds the only copy. Other agents (build, discovery) can read the same repo.

## Three layers, one format

| Layer | What | Where it lives | Who changes it |
|---|---|---|---|
| Craft | How a good operator works anywhere: triage, RCA, DQ, safe reruns, industry practice | Plugin skills (`operations-fleet`) | Us, through the plugin |
| Enterprise | The client's world across teams: brands, markets, affiliates, stakeholders, shared systems, glossary | A shared base granted to several projects (ADR 0012) | Client knowledge owners |
| Project | One team's operations: its pipelines, runbooks, known issues, request types | The project's base (`team-knowledge` by default) | Project owner |

This maps the foundation / enterprise / domain / use-case layering the BMS ontology work uses, without a separate ontology store. Use-case detail is pages inside the project base, not a fourth layer.

**Live truth is never copied.** Run status, current schemas, column descriptions, lineage from Unity Catalog, metric definitions in a semantic layer: Sonic reads those through connectors (`query_data`, pipeline tools, the catalog). Knowledge points at them by name (`catalog.schema.table`, job id) and adds what the system cannot say: why, who, when it matters, what usually goes wrong. Where the client already has an ontology or semantic layer, the base records it as a source and maps business terms onto it; we do not rebuild it.

## What to get from teams

The ops ontology. Each row is a page type with typed fields; the fields are the links.

| Shelf | Page per | Must capture | Typed links (frontmatter) |
|---|---|---|---|
| `operating-manual.md` | project | What Sonic may do alone, what needs a person, never-touch list, escalation, hours, tone | `owner` |
| `business/` (new) | brand, market, affiliate, region | What it is, which pipelines and reports serve it, regional quirks, who cares | `pipelines[]`, `stakeholders[]`, `markets[]` |
| `team/` | role, stakeholder | Owner areas, backup, how to reach, **requester tier** (exec, manager, analyst), what they usually ask, their response expectation | `areas[]`, `brands[]`, `tier` |
| `systems/` | system, environment, tool | Purpose, environments, access path (no credentials), how to get access, limits | `owner` |
| `data/` | dataset, glossary term, rule | Meaning, grain, source of truth, **how people say it** (synonyms, vague phrasings), DQ rules and thresholds, DQ SLAs | `refs[]` (catalog objects), `pipelines[]`, `owner` |
| `pipelines/` | pipeline or feed | Purpose, schedule, **SLA (ready by)**, upstream, downstream, vendor and vendor POC role, safe rerun, usual failures | `upstream[]`, `downstream[]`, `vendor`, `brands[]`, `sla`, `owner` |
| `requests/` (new) | recurring request type | Who asks, how they phrase it, what they actually mean, how to fulfil (tables, filters, checks), gotchas, response SLA | `asked_by[]`, `uses[]` |
| `runbooks/` | procedure | When, before you start, steps, verify, rollback, escalate when | `applies_to[]` |
| `known-issues/` | failure pattern | Symptom, confirm, cause, fix, prevention, seen in (ticket ids) | `pipelines[]`, `systems[]` |
| `decisions/` | decision | Context, decision, reason, rejected options, who and when | |
| `sources/` | link group | What each link is for, when to open it, trust, last checked | |
| `evals/` (new) | test case | A real question or ticket, the expected answer or action, the pages it should cite | `journey`, `cites[]` |

`requests/` is the answer to "business never says which table": the vague ask ("get me Brand X's numbers for last week") and its translation live together, learned from ticket history and from corrections. `team/` tier is how Sonic tells a VP's email from an analyst's question and sets priority and tone.

SLAs are fields, not prose, so Sonic can compare a run against them: `sla: "06:00 Europe/London"` on a pipeline, `response: 4h` on a request type or tier, thresholds on a DQ rule.

Not stored: credentials, ticket bodies, customer or patient data, meeting chatter, live state.

## How it gets built (seed)

Existing flow (SPEC-knowledge-03), with three changes:

1. **Sources**: SOPs and runbooks, Confluence or SharePoint, ServiceNow or Jira history, RCA and issue trackers, the connected systems themselves, and interviews. The ticket audit already turns history into questions.
2. **Platform migrations**: history from before a migration (BMS moving to Databricks) is evidence of what people ask and what breaks, not of how to fix it now. The audit marks pre-migration fixes `legacy` and asks "how does this work on the new platform?" instead of drafting the old fix as a runbook. Interview "new ways of working" first.
3. **Use case first**: the ticket audit ranks request types and failure patterns by volume and time spent. Round 1 of interviews covers the top two or three journeys deeply; the rest gets the broad confirm-or-correct pass. Accuracy is then measured per journey (below), and the next round goes where it is lowest.

### Client documents (Confluence, SharePoint, wikis)

Sonic sorts each document into one of three buckets during the seed, and the build lead confirms in review:

| Bucket | Examples | What we do |
|---|---|---|
| Act on | SOPs, runbooks, escalation lists, SLA tables, owner lists | Distil the steps, thresholds and owners into pages. Cite the document's URL and version or modified date. The document stays the origin. |
| Look up | Architecture docs, data dictionaries, design decks, vendor contracts | Don't distil. One `sources/` entry: what it is for, when to open it. Sonic reads it live through the connector when a task needs it. |
| Skip | Meeting notes, old project plans, pre-migration docs, abandoned drafts | Nothing, except a decision with its reason, which goes to `decisions/` |

Distilled pages drift when someone edits the original. The weekly pass checks each cited document's modified date through the connector and reopens the pages it fed as drafts. That is the same revisit rule `knowledge-extract` already applies to uploaded files.

Connectors: SharePoint is built in (MCP, one granted site). Confluence goes in as a custom MCP connector (Atlassian's remote MCP server) or, until then, as exported pages uploaded to the setup task. Scope each connector to the ops spaces only: Sonic reads with the connector's identity, so anything it can reach, every project member can get through Sonic.

## How agents and people read it

- Agents: root `index.md` first, then `knowledge_catalog` (map of pages and fields), `search_knowledge` for words, Read only the pages needed, follow typed links one hop at a time. Multi-hop questions ("pipeline A is late; which brands and whose reports does that hit, and who do I tell?") are three or four link follows, each one a small read.
- People: the Knowledge page renders the same Markdown; Git gives history and blame; every claim carries a footnote to its source (document hash, ticket id, transcript timestamp and speaker, live read).
- Trust: `status` (draft, kept), `owner`, `updated`, `stale_after`. Kept beats draft, human beats agent, newer beats older when otherwise equal. A runbook never grants permission; the permission policy does.

## How it evolves (the loop)

Every change is a draft a person keeps or discards. Nothing becomes true because Sonic wrote it.

| Signal | When | Becomes |
|---|---|---|
| Lesson capture | A ticket or task closes verified (exists) | Draft page or section |
| Teach moment (new) | A person corrects Sonic or answers its question in any chat ("no, for EU we use the affiliate feed") | Draft append citing the task and who said it |
| Stuck point (new) | Sonic had to ask, or could not find a page | Recorded on the task; feeds the weekly pass |
| Interview round | Transcript uploaded (exists) | Drafts and guide updates |
| Document change | A re-scanned document's hash changed (exists in `knowledge-extract`) | Revisit the pages it fed |
| Drift (new) | A page's typed field disagrees with a live read (schedule, owner group, table gone) | Flagged draft for the page owner |

**Weekly knowledge pass** (a routine, not a pipeline): group the week's stuck points and teach moments, merge duplicate drafts, list pages past `stale_after`, check typed fields against live systems, run the evals, and send the owner one digest: what to keep, what is stale, where accuracy dropped. It drafts; it never keeps.

## Measuring it

`evals/` holds cases per journey: real resolved tickets with the resolution hidden, recurring request types, and every teach moment turned into a question. The weekly pass and every knowledge PR run them: answer using only knowledge and read-only tools, compare with the expected action and cited pages. Result per journey: pass rate and the pages that failed. A drop after a merge names the change that caused it. The `evaluate` skill (built) grades past task logs from the other side: its pushback labels mark where knowledge was missing or wrong, and those feed the weekly pass as gaps.

This is also how autonomy is earned use case by use case: a journey moves from "Sonic drafts, person approves" to "Sonic acts, person reviews" only when its eval rate and live approval history support it. That link to the permission policy needs its own spec.

## What we are not building

- A graph database or graph view as a store. Typed frontmatter links are the graph; if a query ever needs aggregation, `knowledge_catalog` filters by field (`type: Pipeline, brands: X`). A generated graph index can be derived from the files later without changing the source of truth.
- Vector search or RAG. A project base is hundreds of pages; an index, a catalog and word search find them, and the agent reads whole small pages. Revisit only if a base passes a few thousand pages and search misses show up in evals.
- Hidden per-user memory. What we learn about a stakeholder goes in their `team/` page, shared and reviewable.
- A copy of Unity Catalog descriptions or the client's ontology.
- Auto-keeping drafts, or an overnight job that rewrites skills from chat.

## Build order

1. **Structure** (plugin): add `business/`, `requests/`, `evals/`, typed link fields and the legacy rule to `knowledge-build` references; record in `plugin/SOURCE.md`.
2. **Catalog filters and backlinks** (app, spec): `knowledge_catalog` filters by type and field and returns pages linking to a page.
3. **Teach moments** (skill plus one prompt line, spec): capture corrections from any task, not only closed tickets.
4. **Evals** (spec): `evals/` case format, a runner tool, per-journey results on the Knowledge page.
5. **Weekly pass** (routine, spec): stuck points, stale pages, drift, evals, digest.
6. Later: autonomy per journey from eval results (spec, touches the permission policy).

Then run it end to end on Helixa, and on the BMS knowledge interviews once their written requirements arrive.

## Decisions (20 Oct 2026)

- A client ontology or semantic layer (BMS builds one as Delta tables) is read live through `query_data`, never copied. The base gets one `sources/` page saying where it is and when to use it.
- Ownership needs no new rule: project owners keep drafts in project bases, app admins in shared bases, as today.
- Evals run weekly only to start; per-PR runs come later if the weekly rate proves noisy.
- `business/` and `requests/` shelves are agreed.
