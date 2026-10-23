---
name: knowledge-eval
description: Measure how well the knowledge base lets the agent handle real work - answer each kept eval case (a real past ask with its known right answer) using only the knowledge, grade the answers with a fixed rubric, and record a score per journey with the pages that would have fixed each miss. Use for "run the evals", "how good is our knowledge for late pipelines", the weekly knowledge pass, or the self-check at the end of a knowledge build. Not for grading past tasks (use evaluate) or for writing knowledge (use knowledge).
metadata:
  version: 1
  category: sequential
---

# Evaluate the knowledge

The agent's accuracy on a client is the quality of the client's knowledge. An eval case is a page in a base's `evals/<journey>/` folder with `type: Eval Case`, a `journey`, an `expected` line, a `## Ask` (the request as the person saw it) and a `## Expected` (what was actually done). Only kept cases count; a draft case is a proposal.

This skill reads only. It changes no ticket, pipeline, board or page; it records the run.

## 1. Find the cases

With `knowledge_catalog`, filter `type: Eval Case` (and `field: journey` with a value when asked for one journey). Without the tool, list `knowledge/*/evals/**`. Leave out drafts. Say how many cases each journey has; a journey with fewer than 3 kept cases gets a score, marked thin.

## 2. Answer each case blind

For each case, start a fresh subagent and give it only:

- the `## Ask` text, as the request;
- read-only tools: the knowledge (`search_knowledge`, `knowledge_catalog`, Read on `knowledge/`) and the host's read tools for live state;
- the instruction to say what it would do and why, citing the pages it used, and to change nothing.

Never give it the `## Expected` section, the `expected` field, the `source` ticket or this skill's rubric. A subagent that saw the answer makes the run worthless; if one did, rerun that case.

## 3. Grade

Compare each answer with `## Expected`, `expected` and `cites`:

| Result | When |
|---|---|
| pass | Same action, or an equally safe one, for the right reason, and it read at least one page in `cites` when cites are given |
| partial | Right direction with a missing step, a wrong owner or channel, or the right action for a reason the knowledge does not support |
| fail | A different or unsafe action, an invented fact, or "no knowledge applies" when a page covers it |

Grade the action, not the wording. A confident answer with no cited page is not a pass. For each partial or fail, write one sentence on what was wrong and list in `missing` the pages that would have fixed it: existing pages it should have read, or a page that does not exist yet (say so).

## 4. Record

Call `record_eval_run` once per journey with every case you ran. The host computes the score (pass 1, partial 0.5, fail 0) and keeps the history; never compute or report your own number instead of the one it returns. Without the tool, write `eval-run-<journey>.json` in the task folder with the same fields.

## Result

One line per journey: its score, the change since the previous run, and the case count. Then the misses that matter most, each with the page that would fix it. When a fix is a clear, small page, draft it with `update_knowledge` and origin `pass` (or `eval` for a new case); otherwise list it as a gap for an interview.
