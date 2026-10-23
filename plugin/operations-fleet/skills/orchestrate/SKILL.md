---
name: orchestrate
description: Coordinate multi-step operational work that spans several skills, systems, or artifacts - discover the client's knowledge and live state, choose the next specialist skill from evidence, control writes, and finish with one verified result. Use for end-to-end requests such as investigate and fix, triage and update, or build a report and send it, and when it is unclear which skill applies.
metadata:
  category: sequential
---

# Coordinate operational work

Keep one clear owner for the request while specialist skills do focused work.

## 1. Discover the operating context

Read `operations.yaml`, then capture:

- the result the user wants;
- exact records, systems, environments, users, time windows, and files in scope;
- actions that are allowed, approval-controlled, or forbidden;
- what would count as success.

Use `knowledge` to resolve the configured source and select only the concepts relevant to the request before loading a specialist skill. Record the selected concept paths, their trust state, and why they apply. State when no relevant approved knowledge was found. Client-specific people, roles, conventions, systems, and procedures live in knowledge, not in skills.

## 2. Check current evidence

Use connected systems to establish live state. Use `research` when current public facts can change the decision. Knowledge explains how the organization works; live systems establish what is true now; neither grants authority beyond configured policy.

## 3. Build a small case map

Track five things:

```text
Selected knowledge, trust state, and applicability
Known facts and evidence
Assumptions and unresolved questions
Records, IDs, revisions, and artifacts
Allowed actions and approval state
```

When a ticket represents the case, add its key, starting state, and revision or updated timestamp, and keep the key in every specialist handoff. Return to `tickets` after a material case event so the live record does not drift from the work.

Pass the next skill only the goal, relevant evidence, exact identifiers, constraints, and expected result.

## 4. Choose the next skill from knowledge and evidence

Prefer an approved knowledge `Playbook` or `Guideline` that describes the current scenario end to end; this is where a client customizes its own flow, not in any skill. Otherwise choose from current evidence and each skill's own description. There is no mandatory specialist chain. Stop when the next action is unsupported, outside scope, or needs approval.

A saved `workflow` lists in `uses` the connections it relies on, not skills or an order; re-derive the steps from current evidence and any matching playbook on every run.

After an applied ticket change, `tickets` reads the record back. Send an email about it only when the person asked, or when `operations.yaml` or approved knowledge says ticket changes are announced by email.

## 5. Control writes

Follow the approval rules in [reply format](references/reply-format.md#approvals-and-writes): state the exact target and change in one sentence, then act as the task's permission allows. After the write, refresh the authoritative state. Do not retry an ambiguous write until current state has been checked.

## 6. Verify and finish with one result

Use `verification` before claiming a material outcome is complete. A successful tool response is not sufficient when the outcome can be read back or checked independently.

Reply in the shape set by [reply format](references/reply-format.md), with the full write-up in one file ([HTML report](references/html-report.md) or `report.md`). Apply `unslop` to the user-facing prose; do not apply it to raw logs, code, or machine-readable artifacts.
