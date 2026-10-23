# Knowledge structure

Every project's base uses the same shelves, so any client's knowledge reads the same way and the build lead can explain it in one slide: who, where, what, how, what went wrong, why, who asks for what, how well the agent does, plus links and a map. Underneath it is Open Knowledge Format: Markdown with YAML frontmatter, one concept per file, the path is its identity. When the base already has its own layout, follow that and map these shelves onto it instead of moving pages.

| Shelf | Answers | One page per |
|---|---|---|
| `operating-manual.md` | What the agent is here, what it may and may not do, escalation, tone | project |
| `team/` | Who owns what, who to ask, on-call and escalation | role or ownership area |
| `systems/` | Where things run: platforms, environments, repositories, tools, access paths | system or environment |
| `data/` | What the data means: domains, key tables, glossary terms, business rules, data quality rules, SLAs | dataset, term, or rule |
| `pipelines/` | What each job does, its schedule, upstream and downstream, owner, usual failures | pipeline |
| `runbooks/` | How to do routine and recovery work, step by step | procedure |
| `known-issues/` | What went wrong before: symptom, how to confirm, cause, fix, prevention | failure pattern |
| `decisions/` | Why things are the way they are | decision |
| `business/` | The business the data serves: brands or products, markets, affiliates, stakeholders and their tier, vendors and their contacts | brand, market, stakeholder, or vendor |
| `requests/` | What people usually ask for, in their words, and what it means in data: tables, filters, the person who signs it off | kind of request |
| `evals/` | Test cases from real resolved work: the ask as the person saw it and what the right answer was | case, in a folder per journey |
| `sources/` | External links worth knowing: what each is for and when to open it | link or group of links |
| `index.md` | The map: what is here and how to use it | base (one per folder too) |

## Live truth is read, not copied

Anything a live system already holds is read from it at the time of use, never copied into a page: table and column lists, the data catalog, a business ontology or semantic model, job schedules, row counts. A page says what the thing is for, who owns it, and how to find it (`refs` and `systems`), so it does not go stale when the system changes.

History from before a platform migration describes a system that is gone. Keep what still explains today's behaviour, mark it `era: legacy`, and never present a legacy fix as today's procedure.

## Typed fields

Relationships between pages live in the frontmatter, so an agent can ask "which pipelines feed this brand" or "who asked for this" without reading every page. A value is a page path inside the base (with or without `.md`) or plain text for something with no page yet.

| Link field | Points at |
|---|---|
| `upstream`, `downstream` | the feeds or tables a pipeline reads from and writes to |
| `pipelines` | the pipelines a dataset, brand, or request depends on |
| `brands`, `markets` | the brands or products and the markets a page applies to |
| `stakeholders`, `asked_by` | the people who use the output, and who asks for a kind of request |
| `vendor` | the supplier of a feed, and its page with the contact route |
| `owner` | the role or person who owns the page's subject |
| `uses`, `applies_to` | the runbooks a page relies on, and what a rule or decision applies to |
| `systems`, `refs` | the systems involved, and the live objects to read (tables, jobs, dashboards) |
| `related`, `supersedes` | neighbours worth reading, and the page this one replaces |

| Scalar field | Holds |
|---|---|
| `sla` | when the output must be ready, with the timezone ("07:00 ET") |
| `tier` | a stakeholder's tier ("VP", "Director", "Analyst"); it sets how fast and how carefully to answer |
| `response` | the expected response for that tier or request ("same day", "next sprint") |
| `journey` | for an eval case, the journey it tests ("late-pipeline") |
| `era` | `legacy` for knowledge from before a migration |
| `stale_after` | the review date (YYYY-MM-DD) |
| `expected` | for an eval case, the right action or answer in one line |

With `update_knowledge`, give these as `fields`; an append may give only fields, and lists are merged. Use only the fields above; put anything else in the body.

## Page rules

- One concept per file, under 500 lines. A `description` that makes sense on its own: search results and the map show only that line.
- Frontmatter: `type`, `title`, `description`, `status: draft`, `owner` when known, `updated`, `stale_after` (a review date: about 6 months for procedures and owners, 12 for definitions and decisions), and `sources`.
- Every material claim carries a footnote keyed to a `sources[].id`. A source is a document (path and sha256), a ticket (id), a live system read (system, object, date read), a transcript (file, timestamp, speaker), or a public page (URL, date read).
- Keep observed fact, policy, procedure, historical example, and recommendation apart. Mark anything heard but not confirmed as unconfirmed.
- Never copy personal data, customer data, credentials, or ticket bodies. Generalise ("a customer-facing load").

## Templates

Headings for each type. Use the neighbours' headings when the base already has some.

- **Operating manual** (`type: Operating Manual`): Purpose here, What the agent may do, What needs a person, Never touch, Escalation, Working hours and tone.
- **Team** (`type: Ownership`): Area, Owner (role, then person when the source is authoritative), Backup, How to reach, Escalation path.
- **System** (`type: System`): What it is for, Environments, Access path (no credentials), Owners, Limits and known quirks.
- **Data** (`type: Dataset`, `Glossary Term`, or `Rule`): Meaning, Grain and keys, Source of truth, Rules and thresholds, Owner, Consumers.
- **Pipeline** (`type: Pipeline`): Purpose, Schedule and SLA, Upstream, Downstream, Owner, Usual failures (links to known issues), How to rerun safely.
- **Runbook** (`type: Playbook`): When to use, Before you start, Steps, How to verify, Rollback, Escalate when.
- **Known issue** (`type: Failure Pattern`): Symptom, How to confirm, Cause, Fix, Prevention, Seen in (ticket ids).
- **Decision** (`type: Decision`): Context, Decision, Reason, Alternatives rejected, Date and who decided.
- **Brand or market** (`type: Brand`, `Market`): What it is, Markets or affiliates, Key data and pipelines, Stakeholders, Calendar (launches, closes, reporting dates). Fields: `markets`, `pipelines`, `stakeholders`.
- **Stakeholder** (`type: Stakeholder`): Role, What they use, How they ask, What good looks like for them. Fields: `tier`, `response`, `brands`. Name the role first; name the person only when an authoritative source does, and never copy contact details beyond a work channel.
- **Vendor** (`type: Vendor`): What they supply, Delivery schedule, Usual problems, Contact route (a role or queue, not a personal number), Contract notes that change how to act. Fields: `pipelines`, `sla`.
- **Request** (`type: Request`): How people phrase it, What it means in data (tables, filters, grain), Checks before sending, Who signs off, Examples (ticket ids). Fields: `asked_by`, `refs`, `pipelines`, `response`.
- **Eval case** (`type: Eval Case`, in `evals/<journey>/`): `## Ask` (the question or ticket as the person saw it, no resolution) and `## Expected` (what was actually done and why). Fields: `journey`, `expected`, and `source` (the ticket id). List in `cites` the pages a good answer reads.

## The map

The root `index.md` tells an agent how to use the base, in this order: one paragraph on what the base covers; "Start here" with the operating manual and the two or three pages most tasks need; one section per shelf, each line a link and its description; an "Optional" section for pages to read only when the task needs them.

## External sources

A `sources/` page lists links the knowledge does not copy. One entry per link:

```markdown
- [Sales load dashboard](https://example.com/d/sales): run history and row counts for the nightly sales load. Open when checking whether last night's load finished. Trust: internal, authoritative. Checked 2026-10-13.
```

Say what the link is for, when to open it, how far to trust it (internal authoritative, internal informal, public vendor, public other), and when it was last checked. Never put a link with credentials or a token in it.
