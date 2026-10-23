# Databricks monitoring

Use exact workspace, job, run, task, pipeline, query, and table identifiers.

## Useful evidence

- Job and task run details, including attempts, parameters, cluster or serverless environment, code source, state, error, and timing.
- `system.lakeflow.job_run_timeline` and `system.lakeflow.job_task_run_timeline` where available.
- Pipeline update details and event logs.
- Query history and warehouse state for SQL failures.
- Unity Catalog lineage for upstream and downstream exposure.
- DQ expectation results or the team's own result tables.
- Delta table history (`DESCRIBE HISTORY`) for each layer the job writes: whether the run committed a version, its `operationMetrics`, and the version to pin later reads to. See [data-level checks](data-level-checks.md).
- Audit logs, permissions, and recent job or cluster configuration changes.

## Recency gate

For an existing job investigation, list at least the five newest parent runs when the API and retention window allow it. Sort by start time descending rather than assuming provider response order. Record the newest parent run, the newest completed run, and any active run before opening the run cited by a ticket.

Use the ticket-cited run as historical context when a newer run exists. Inspect the newest failed task and its latest attempt to describe current health. A successful repair of an older parent run is not recovery evidence when a later parent run failed.

## Important cautions

- A job ID is only unique within its workspace; retain workspace ID too.
- Long timeline rows may be sliced into intervals; reconstruct the full execution.
- Retry and repair attempts must be distinguished from the original run.
- System-table availability, fields, retention, and update timing can change by cloud and feature status.

Official sources:

- [Jobs system tables](https://docs.databricks.com/aws/en/admin/system-tables/jobs)
- [Lineage system tables](https://docs.databricks.com/aws/en/admin/system-tables/lineage)
- [Troubleshoot job failures](https://docs.databricks.com/aws/en/jobs/repair-job-failures)
