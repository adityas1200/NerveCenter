---
name: rca
description: Investigate an operational failure and produce an evidence-backed root-cause analysis. Use for failed jobs, pipelines, data-quality checks, queries, services, deployments, access failures, recurring incidents, downstream impact, and requests asking why something failed.
metadata:
  category: modular
---

# Investigate root cause

Produce a blameless explanation that another operator can challenge and act on. RCA is read-only, except for an approved evidence snapshot (step 5). Any other action needs a separate request.

## When the host offers investigation tools

- `record_finding` as you go, one call per hypothesis (with an id), piece of evidence or ruled-out cause (pointing at its hypothesis), root cause (with confidence), fix, and verification. Record `inconclusive` rather than guessing.
- `describe_board_data` then `query_data` for data-level evidence (step 5).
- `show_lineage` for upstream and downstream impact (step 7), with the broken asset marked failed or stale and what it feeds marked affected.
- `show_timeline` for the timeline from last known good to now.

These cards carry the evidence, so the chat reply can stay short.

## When the host offers `find_similar_tickets`

Search once, early (after framing the incident, before settling on a cause): call it with the ticket id, or with the error text when there is no ticket. Read the top hits for their resolution, the `root_cause`, `fix` and `verification` findings of the task that worked them, and whether the match was the same signature or only similar text. If `get_ticket` shows a `recurrence`, an earlier fix did not hold: find out why before proposing anything.

- A past fix is a hypothesis, not an answer. Give it an id, test it against the current evidence (the same failing task, error and data window), and record the result with `record_finding`: evidence that supports it, or `ruled_out` with the difference that rules it out. Cite the earlier ticket as a ticket evidence reference. Never recommend a past fix because it worked before.
- Similar text is a weaker signal than the same signature; say which it was, and do not stretch a loose match to fit.
- When the evidence shows the past fix was insufficient and needed amending, record that in the root-cause and fix findings, and, where ticket writes are allowed, link the tickets with `link_related_ticket` (`amends_fix_of`, or `recurrence_of` when the same problem simply came back) and comment on the earlier ticket with a short summary of the amendment. The write-up and the knowledge lesson (see the knowledge skill's lesson capture) describe it as the earlier fix and what changed ("fix v1 ... amended because ...").

## Method

1. Frame the incident: exact asset, environment, first observed time, affected window, symptom, impact, and what is known not to be affected.
2. Refresh the asset's live state independently of the incident identifier — the newest and any active execution — before deciding whether the incident is ongoing, recovered, or superseded by a different failure.
3. Build an evidence pack with stable IDs (executions, tasks, queries, logs, code and configuration revisions, permissions, lineage, related tickets) and a short timeline from last known good through detection to current state.
4. Compare last-good, first-bad, and newest for changes in inputs, code, configuration, runtime, permissions, compute, schedule, or data shape. List credible hypotheses with supporting evidence, contradicting evidence, and the smallest test that would tell them apart. When a pipeline or query failed, test the compute and infrastructure hypotheses too, from the platform's own APIs and system tables; read [infrastructure causes](references/infrastructure.md).
5. When the symptom is stale, missing, partial, or wrong data, including after a run that reported SUCCESS, query the tables and not only job metadata. Compare the same keys, batch, or window across source, staging, and target, pinned to table versions, and find the first layer where the data diverges. If that evidence could be lost before the RCA is reviewed, because the next run overwrites it or it leaves time-travel retention, propose an evidence snapshot: a shallow clone at the pinned version. Creating it is a write; follow the approval rules, record it, and plan its cleanup. Read [data-level evidence](references/data-level-evidence.md).
6. Establish the causal chain — trigger -> mechanism -> failure -> observed symptom -> impact — separating root cause, trigger, contributing conditions, and detection or recovery gaps. Do not stop at the last error message.
7. Trace upstream and downstream impact, state confidence (high/medium/low) with the missing evidence that could change it, and recommend testable actions in layers: containment, durable correction, detection improvement, recurrence prevention. Do not perform them here.
8. Never call the asset fixed or recommend closure unless an execution newer than the correction completed successfully and the intended outcome was independently verified — an older repair succeeding does not excuse a newer failure.

## Reply and write-up

The chat reply follows the [reply format](../orchestrate/references/reply-format.md): the headline, then at most four of these headings, only where they carry something material: `Root cause`, `Impact`, `Confidence`, `What to do next`.

The full RCA goes in the one write-up file, with these sections:

```text
Executive summary
Impact and scope
Timeline
Evidence, including pinned table versions and any evidence snapshot
Root cause and causal chain
Contributing conditions
Alternatives considered
Upstream and downstream impact
Confidence and missing evidence
Recommended actions and verification criteria
```

Use current official documentation through `research` when platform behavior, limits, or error semantics matter.

Read [causal reasoning](references/causal-reasoning.md), [infrastructure causes](references/infrastructure.md), [Databricks](references/databricks.md), [Snowflake](references/snowflake.md), [data quality](references/data-quality.md), [data-level evidence](references/data-level-evidence.md), and [action quality](references/action-quality.md) as needed.
