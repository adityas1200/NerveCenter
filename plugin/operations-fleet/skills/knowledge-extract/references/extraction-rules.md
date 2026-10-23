# Extraction rules

## Keep or reject

| Content in the document | Decision |
|---|---|
| Ordered steps to restart, replay, fail over, or check something | Keep as a procedure. Preserve order, preconditions, and verification steps. |
| "Escalate to X after 30 minutes", on-call rota rules, owning team | Keep as owner or escalation. Name the role, and the person only if the document is the authoritative source. |
| A definition, threshold, SLA, or naming rule | Keep as a definition or rule, with its scope. |
| An incident write-up with a confirmed cause and fix | Keep the failure pattern: symptom, how to confirm it, cause, fix, and prevention. Drop the timeline chatter. |
| An incident still under investigation, or "we think it was..." | Reject, or keep only the confirmed detection step. A hypothesis is not knowledge. |
| A decision with its reason ("we chose X because Y") | Keep as a decision. Keep the reason. |
| Meeting attendees, agenda, scheduling, "will follow up" | Reject. |
| A spreadsheet of values (ticket export, cost rows) | Reject the values. Keep only definitions found in column headers or a legend. |
| A slide deck | Keep the stated rules, decisions, and procedures. Drop marketing framing and speaker small talk. |
| Customer names, personal data, ticket bodies, credentials | Never copy. Generalize ("a customer-facing load") or reject. |

When two documents disagree, keep both claims visible in the draft. Name each source and date and flag the conflict. Do not choose one.

## Concept format

Match the neighbouring concepts first. When there are none, use this layout:

```markdown
---
type: Playbook
title: Restart the nightly sales load
description: How to confirm and safely restart the nightly sales load after an upstream delay.
tags: [sales-load, restart, upstream-delay]
status: draft
owner: Data Operations
updated: 2026-10-01
sources:
  - id: sop-sales-load
    resource: inbox/SOP-sales-load.docx
    sha256: 4fac50b9e882f6e91618a98ca98d418d662709e2f50aff3ac96d957c47536250
---

# Restart the nightly sales load

## When to use
...

## Steps
1. Confirm the upstream file arrived.[^sop-sales-load]
...

[^sop-sales-load]: SOP-sales-load.docx, section "Restart", uploaded 2026-10-01.
```

- Use the `sources[].id` as the footnote label.
- Use the document path as the scan returned it, and the full sha256.
- Keep each concept to one topic. Split a long SOP into separate procedure concepts only when the parts are used separately.

A section added to an existing concept keeps that concept's lifecycle. Mark the section itself as a draft:

```markdown
<!-- draft source=inbox/incident-2026-09-12.md sha256=<first 12 chars> updated=2026-10-01 -->
## Late upstream file
...
<!-- /draft -->
```

For a conflict with approved text, add a draft note under the affected section that starts with `Conflict:`. Name both sources and the owner who should decide.

## Recording outcomes

- `curated`: the document produced or changed one or more concepts. List every concept it fed.
- `merged`: the knowledge base already covered it, and nothing was written. Name the concept that covers it.
- `rejected`: nothing reusable. Give the reason in one sentence, for example "meeting logistics only" or "unconfirmed hypothesis".

## Empty knowledge base

Create `index.md` at the knowledge root, then add folders only as the content needs them:

```markdown
---
type: Index
title: <Team> knowledge
description: Entry point for the team's operating guidance.
status: draft
---

# <Team> knowledge

## Playbooks
- <Markdown link to playbooks/restart-nightly-sales-load.md, titled "Restart the nightly sales load">
```

Use OKF conventions:

- every page has YAML frontmatter with a non-empty `type`;
- links are relative or bundle-absolute (`/playbooks/x.md`);
- the path is the concept's identity.

If the client's knowledge system publishes its own OKF specification, follow it instead. See [OKF notes](../../knowledge/references/okf.md).
