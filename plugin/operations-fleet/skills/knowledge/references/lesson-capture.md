# Lesson capture

Use after verified work to decide whether knowledge should change, and where. The names below are illustrative; always decide from the client's own knowledge index and concepts.

## 1. Relevance: is there a reusable lesson?

Capture it when a future operator would act faster or better because of it:

- a failure pattern with a confirmed cause and fix;
- a faster way to detect or confirm a problem;
- a procedure step that was missing, wrong, or out of date;
- an owner, escalation path, or definition the work had to discover;
- a decision with its reason that others will need.

Skip it when:

- verification did not pass, or the cause is still a hypothesis;
- it was a one-off with nothing to generalise, such as a typo in a request;
- the work followed existing knowledge exactly, so knowledge already did its job;
- the only content is identifiers, customer data, secrets, or personal details.

## 2. Redundancy: is it already known?

Search several ways: the error text or signature, the component or system, the symptom a person would notice, and the cause. Read the closest concepts; a search snippet is not enough to decide.

Compare substance, not labels:

| New lesson vs. existing concept | Action |
|---|---|
| Same symptom, same cause, same fix | Skip, also when the matching entry is still an unreviewed draft. Add an occurrence only when the page already keeps a reviewed list of where the issue was seen. |
| Same cause on a different component | Update the existing entry: add the component and any new fix step. |
| Same symptom, different cause | New entry next to the existing one, cross-linked. |
| Better or corrected fix | Add the improvement as a draft note; do not rewrite approved text. When it amends a fix recorded for the same failure pattern, write it under that entry as "fix v1 ... amended because ..." so both versions and the reason stay together. |
| Contradicts an approved concept | Flagged note for the concept owner; do not overwrite. |

Example: two tickets both report "daily load failed". One was a source file that arrived late, the other a schema change. They share a category but not a cause, so they are two lessons. A third ticket with the same schema change on another load updates the second lesson instead of adding a new one.

## 3. Placement: where does it belong?

1. Open the root index and each candidate base's index. Read titles, descriptions, tags, and section headings.
2. Name the kind of lesson: failure pattern, procedure, definition, owner or contact, decision, or template.
3. Choose the concept or folder whose description says it holds that kind of lesson for that area. Prefer, in order:
   - a section in an existing concept;
   - a new concept in the closest folder;
   - a new folder, only when nothing fits and the lesson opens an area others will add to.
4. Follow the target's structure: the same headings, order, and terms as neighbouring sections.
5. Keep the reason for the choice in one sentence that quotes the description it matched.

## 4. Asking

Ask only after reading the candidates, when one of these is true:

- two places fit equally well and the choice changes who owns or finds it;
- a possible duplicate differs in a way you cannot judge from the evidence;
- the lesson may conflict with an approved concept.

"It might already be covered" is not a reason to ask; read the concept and decide. Ask one question with two or three concrete options, including not adding it. If there is no answer, add nothing.

## 5. Draft format

When the host offers `update_knowledge`, it adds these markers itself; give it the content only. Without it, write them by hand:

A new concept:

```markdown
---
type: <same type as its neighbours, for example Playbook>
title: <plain title>
description: <one sentence on what this concept covers>
tags: [<component>, <symptom>]
status: draft
owner: <owner of the folder or base, when known>
source: <ticket or task ID>
updated: <YYYY-MM-DD>
---
```

A section added to an existing concept keeps the concept's own lifecycle, so mark the section itself as a draft and name its source:

```markdown
<!-- draft source=<ticket or task ID> updated=<YYYY-MM-DD> -->
## <Short name of the lesson>
...
<!-- /draft -->
```

Treat a draft section as a lead, not as approved knowledge, until it is reviewed.
