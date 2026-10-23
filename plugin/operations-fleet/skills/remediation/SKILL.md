---
name: remediation
description: Recover or safely change an operational system by retrying, repairing, reprocessing, cloning a data resource for isolated validation, correcting data or configuration, deploying an approved artifact, promoting it, rolling it back, or restoring service. Use after the failure mechanism and intended outcome are understood.
metadata:
  category: modular
---

# Remediate safely

Choose the smallest action that can produce the intended state with a known blast radius and recovery path.

## When the host offers `find_similar_tickets`

Before choosing the action, search for earlier tickets with the same failure (the ticket id, or the error text) unless the RCA already did.

- A past fix is a hypothesis. Check it against the current evidence and the preflight (step 3) before it becomes the planned action, and record the check with `record_finding`. Never apply a past fix just because it worked on another ticket; if the same fix was already applied and the failure came back, it is not enough on its own.
- If the past fix proves insufficient and the action you take amends it, link the tickets with `link_related_ticket` (`amends_fix_of`, with a `comment` on the earlier ticket summarising what the first fix missed and what changed), and capture the amended fix through the knowledge skill's lesson capture as an addition to the existing failure-pattern concept ("fix v1 ... amended because ..."), not a second concept.
- After you resolve a ticket whose fix amended a past fix, offer the person a review of other tickets that may carry the weaker fix: use `AskUserQuestion` with the choice to review tickets that applied the same fix pattern or hit the same pipeline or signature (find them with `find_similar_tickets`). Frame it by fix pattern and by system, never by who made or closed a ticket; do not audit, compare, or rank people. If the person declines, do nothing more.

## Method

1. Confirm the exact target, environment, run or data window, desired outcome, supported cause, authority, and verification criteria.
2. Choose the action type: retry, repair, reprocess, clone-first validation, configuration change, bounded data correction, deploy, promote, rollback, or restore.
3. Preflight the action:
   - current state and any in-progress work;
   - partial writes or side effects;
   - idempotency and duplicate risk;
   - checkpoints, watermarks, partitions, and dependent work;
   - exact code revision or immutable artifact;
   - permissions, change window, rollback, and stop conditions.
4. Prefer a dry run, preview, or dev execution when it can meaningfully reduce risk.
5. State the exact action and expected effect in one sentence and follow the approval rules in [reply format](../orchestrate/references/reply-format.md#approvals-and-writes). When the host offers `show_change`, show the diff and how it was tested before the change is applied, and again with state `applied` afterwards.
6. Execute one bounded action. Record exact parameters, provider IDs, time, and idempotency or correlation key when available.
7. If the provider response is missing or ambiguous, read current state before retrying.
8. Read back delivery or recovery state. Deployment success and business recovery are different claims.
9. Use `verification` to test the original failure, desired state, and likely side effects.
10. Roll back or stop when a stop condition is met; do not improvise a wider repair.

## Write-up outline

```text
Target and intended outcome
Action selected and why
Preflight findings and risk
Approval used
Exact action and provider record
Read-back state
Rollback or recovery status
Verification required or result
Remaining risk and next step
```

For deployments, promote the exact artifact that was reviewed and tested; do not silently rebuild it between environments. Use `research` for current platform behavior.

For a material change to a table or dataset, validate it on an isolated copy first, using the platform's native zero-copy or shallow clone (Databricks `SHALLOW CLONE`, Snowflake `CLONE`, BigQuery table clone, or the equivalent); work out the exact syntax for the connected platform. Copy creation, the copy change, the later change to the original, and cleanup are four separate writes, each with its own authority check. A passing test on the copy is not permission to change the original. When the host offers tested-fix tools (a sandbox, a proposal it measures, apply by proposal id), use them for SQL table fixes instead of raw SQL. Read [clone-first validation](references/clone-first-validation.md).

Read [Databricks recovery](references/databricks.md), [Snowflake recovery](references/snowflake.md), and [deployment discipline](references/deployments.md) as needed.
