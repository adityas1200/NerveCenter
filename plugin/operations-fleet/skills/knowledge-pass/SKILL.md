---
name: knowledge-pass
description: The weekly knowledge pass - review the week's agent work for where it got stuck or was corrected, tidy the drafts waiting for review, find stale pages and typed facts that no longer match the live systems, run the knowledge evals, draft fixes for clear gaps, and record one digest for the knowledge owner. Use when a scheduled weekly knowledge routine runs, or when asked to "do the knowledge pass" or "what changed in our knowledge this week". Not for a single lesson (use knowledge) or building a base from scratch (use knowledge-build).
metadata:
  version: 1
  category: sequential
---

# Weekly knowledge pass

Knowledge goes stale and drafts pile up. Once a week, find what the knowledge lacks and what has drifted, and tell the owner in one digest. Nothing becomes knowledge without a person: draft, never keep, discard or approve.

## 1. The week's work

List the tasks of the last 7 days (`list_tasks` with `since`), leaving out this routine's own runs. Read each with `get_task_log`. Stuck points are in its signals: questions the agent asked, rejected or blocked actions, interruptions, tool errors, and corrections from the person. Where an `evaluate` report exists for the week, use its pushback labels. Group stuck points by what knowledge was missing, not by task. Each group is a gap: one sentence, its journey, and the task ids.

## 2. Drafts waiting

For each base, count the drafts waiting and how many came from corrections and from lessons. When two drafts say the same thing, append the newer content to the older draft's page and record the merge in the digest; never discard a draft.

## 3. Stale and drifted

- **Stale:** `knowledge_catalog` with `stale: true` lists pages past their `stale_after` date.
- **Drift:** for typed fields a live tool can confirm, compare the page with the system: a pipeline's schedule and owner from the pipelines tools, tables in `refs` with one read-only query. Report each difference with the page value and the live value. Do not edit the page to match; the system may be the one that is wrong.
- **Changed sources:** for pages whose `sources` cite a document in a connected system, check its modified date through that connector. Report documents changed after the page's `updated` date.

Read at most what the week needs: the pages linked from gaps and drafts, and the typed pages of the busiest journeys.

## 4. Evals

Run the `knowledge-eval` skill for every journey with kept cases. Note each score and its previous one; the weakest journey is where the next interview should go.

## 5. Draft fixes

For a gap with a clear, sourced answer (a correction someone gave, a resolution that worked), draft it with `update_knowledge` and origin `pass`. For one with no answer, put it in the digest as a question for the owner. Keep it to the few fixes that matter most.

## 6. Record the digest

Call `record_knowledge_digest` once with drafts, stale, drift, changedDocs, gaps, evals, weakest and a one-paragraph summary: what to keep, what is stale, where accuracy moved. Without the tool, write `knowledge-digest.json` in the task folder.

## Result

Two lines: the counts (drafts waiting, stale pages, drift, gaps), then the eval movement and the weakest journey. The host shows the digest on the Knowledge page.
