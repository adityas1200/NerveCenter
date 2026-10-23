---
name: knowledge
description: Find, assess, and use approved organizational knowledge, or propose a reviewable improvement to it. Use for SOPs, runbooks, ownership, business definitions, data rules, escalation paths, historical decisions, operating conventions, knowledge conflicts, and capturing lessons learned after a ticket or task is closed and verified.
metadata:
  category: modular
---

# Use and improve organizational knowledge

Retrieve the smallest relevant knowledge set. Do not load an entire knowledge base when one concept or runbook is enough.

To build or update knowledge from a folder of uploaded documents, use `knowledge-extract` instead.

Knowledge is the agent's only memory between tasks, and the place where everything client-specific lives: people and roles, conventions, systems, procedures, and past incidents.

## When the host offers knowledge tools

- `search_knowledge` to find pages by words before answering a "how do we", "what counts as", or "who owns" question; then Read the pages it points to and cite their paths.
- `knowledge_catalog` for the map of bases and pages (titles, descriptions, types, status, headings, typed links and backlinks) when deciding where a lesson belongs. Filter it to follow relationships: `type`, a `field` with a `value` ("pipelines whose `brands` include this brand"), `linksTo` (everything that points at a page) or `stale`.
- `update_knowledge` to save a lesson (`create`, `append`, or `skip`) instead of writing files. It adds the draft status or draft markers itself, so give the content without them. Give relationships and typed facts (an SLA, a stakeholder's tier, the brands a pipeline serves) as `fields`; an append may give only fields. Say where it came from with `origin` when the host takes one. A person reviews each draft before it counts.

## Find and apply knowledge

1. Turn the task into focused questions (procedure, owner, definition, policy, exception, template, or known failure pattern), then resolve the knowledge source from `operations.yaml` and search its index or catalog — never scan or load the whole bundle by default.
2. Check each concept's lifecycle, ownership, freshness, and provenance. When `approved_only` is true, only stable, human-reviewed concepts are authoritative; treat a draft or unverified concept as a lead, not policy or approval.
3. Keep knowledge separate from live truth and from permission: a runbook describes a procedure, not the current system state or a grant of write access — get those from a live system, and use `research` only for changing public facts, never private knowledge.
4. When sources conflict, show the conflict and prefer whichever is current, approved, specific, and applicable — a human-authored concept outranks an agent-authored one, and a more recent one outranks an older one, when both are otherwise equal. Do not hide stale guidance. Cite the concepts used in the result.

## Capture a lesson from completed work

Run this after a ticket or task is closed and verified, or when an outcome shows that knowledge is wrong or missing. Decide on your own; ask only when you genuinely cannot decide. Do not narrate this step or list the draft among files or records changed in the final reply, unless the host has no other way to show it.

1. **Is there a reusable lesson?** Skip when the outcome was not verified, the case was a one-off with nothing to generalise, the work followed existing knowledge exactly, or the only content is sensitive detail.
2. **Is it already known?** Search by symptom, error text, component, and cause, then read the closest concepts. Compare the lesson's substance (symptom, affected component, root cause, fix), not the ticket's category.
   - Fully covered: skip.
   - Partly covered: add only what is new, such as another cause, a better fix, or another place it occurred. When the work amended an earlier fix, add it to the existing failure-pattern concept as "fix v1 ... amended because ...", keeping the original fix visible, rather than creating a second concept.
   - Contradicts an approved concept: do not overwrite it; add a flagged note for its owner.
3. **Where does it belong?** Read the knowledge index and match the kind of lesson to the concept or folder whose description covers it. Prefer, in order: a section in an existing concept, a new concept in the closest folder, a new folder. Follow that concept's structure and terminology.
4. **Write the smallest reusable lesson.** Separate established fact, interpretation, recommendation, and open question. Link the evidence and the source record. Without `update_knowledge`, mark it draft yourself (see [lesson capture](references/lesson-capture.md)) and name the owner who reviews it.
5. **Ask only when you genuinely cannot decide:** two equally good places, a possible duplicate you cannot rule out after reading it, or a possible conflict with an approved concept. Ask one short question with concrete options, including not adding it, and never more than once per piece of work. If there is no answer, add nothing.
6. Never publish, promote, or approve your own draft; leave that to the configured review path.

Read [lesson capture](references/lesson-capture.md) for the relevance, redundancy, and placement tests with examples.

## Capture a correction

When a person corrects you or tells you how their world works (a rule, an owner, an SLA, who to ask, what a term means, which brand or market something is for), that is the cheapest knowledge there is. Save it in the same turn, without asking:

1. **Is it reusable?** A fact about their organisation, data, people or way of working is. A preference for this one task ("just the top five this time") is not; skip it.
2. **Is it known?** Check `knowledge_catalog` and the closest pages, the same as for a lesson. If an approved page says otherwise, do not overwrite it: add a flagged note that names who said what, for the page's owner.
3. **Save it** with `update_knowledge`, `origin: correction` and `taughtBy` set to the person's name, as a section on the closest page or a field on it (`fields: {tier: VP}`). Quote what they said in one line and keep it as their statement, not as confirmed fact.
4. **Carry on.** The host shows the person that it was saved for review; do not mention it again or ask them to confirm it.

Never save what someone says about a colleague's performance, personal details, or anything they asked you not to keep.

## Result

Give the answer or proposed change with the concepts it rests on, any conflict or freshness concern, and the live checks still required. The trust detail of every concept consulted belongs in the write-up file, not the reply (see [reply format](../orchestrate/references/reply-format.md)).

Read [OKF notes](references/okf.md) and [source trust](references/source-trust.md).
