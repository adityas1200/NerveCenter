---
name: monitoring
description: Review operational failures and correlate related signals across jobs, pipelines, data-quality checks, queries, alerts, logs, and dependencies. Use for what failed today, failed pipelines, failed DQ checks, noisy alerts, first failure, recurring failures, and incident signal review. Also use to observe or check the health of a pipeline and its runs when nothing has failed, including observation routines.
metadata:
  category: modular
---

# Review failures and signals

Turn a noisy set of symptoms into a small number of actionable failure groups.

## When the host offers monitoring tools

When the host offers `list_pipelines`, start there instead of rebuilding run history from system tables: it gives each pipeline's latest run, health (including `overdue`, a scheduled run that never happened), last failure reason, and linked ticket. Then use:

- `get_pipeline_runs` for the newest-first run list the recency gate in step 2 needs;
- `data_quality_results` for failing and warning checks and the tickets that track them;
- `describe_board_data` for real table and column names, then `query_data` for each data-level check in step 4 (one read-only SELECT, values bound as parameters, results kept small).

Go to the platform's own APIs or system tables only for evidence these do not hold, such as task-level errors, cluster events, or table history.

## Method

1. Resolve the systems, environments, assets, and time window. Record the timezone.
2. Establish recency from the live system before anchoring on a run named in a ticket, alert, or request. Enumerate the asset's current executions newest first, identify the newest parent execution and any active execution, and treat an older named run as historical evidence unless it is still the newest. A repaired historical run does not prove current health when a newer execution exists.
3. Collect failed, late, cancelled, degraded, or threshold-breaching events with stable run, task, query, check, alert, and asset IDs.
4. Do not accept a SUCCESS status as data health. Job metadata proves the code ran, not that the right data landed. For each data pipeline in scope, query the produced tables read-only: target freshness against the expected window, row counts for the same batch or window across layers, and presence of expected markers or keys from source through target. Pin each read to a table version or timestamp. A run that succeeded but left stale, missing, or partial data is its own failure group. Read [data-level checks](references/data-level-checks.md).
5. Normalize timestamps, states, severity, owner, and dependency names without discarding provider-specific evidence.
6. Find the earliest meaningful failure in each dependency chain. Later failures may be symptoms.
7. Compare the last relevant success, the first bad execution, the newest execution, and any retry or repair. Check changes in code, configuration, inputs, permissions, compute, schedule, and upstream availability.
8. Correlate signals only on real shared evidence — the same execution, asset, dependency, release, or error signature. Time proximity alone is not causation.
9. Collapse duplicate and cascading alerts while preserving the original evidence and affected assets.
10. Separate:
   - confirmed failure;
   - likely related symptom;
   - possible correlation;
   - unrelated noise;
   - missing evidence.
11. Rank groups by business impact, downstream exposure, SLA risk, recurrence, and readiness for investigation.

## Write-up outline

The chat reply follows the [reply format](../orchestrate/references/reply-format.md); for several failure groups, show them as one `show_table` card when the host offers it. Per group, the write-up covers:

```text
Failure group and current state
Newest execution and relationship to any ticket-referenced execution
First meaningful failure
Affected runs, checks, assets, and environment
Evidence linking or separating signals
Last good versus first bad differences
Data-level evidence: freshness, layer counts, markers, pinned versions (or why it could not be checked)
Known impact and possible exposure
Likely owner
Recommended next diagnostic step
```

Do not remediate inside monitoring. Use `research` for current provider semantics, then use `rca` for causal analysis.

Read [Databricks](references/databricks.md), [Snowflake](references/snowflake.md), [data quality](references/data-quality.md), and [data-level checks](references/data-level-checks.md) when relevant.
