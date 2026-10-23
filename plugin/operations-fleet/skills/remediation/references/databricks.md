# Databricks recovery

Before retrying or repairing a run, identify every task and side effect that may run again.

Important behavior:

- A repair reruns unsuccessful tasks and dependent tasks according to the selected repair request.
- A rerun starts the task from the beginning; the platform does not make task logic idempotent.
- A task that wrote part of its output before failing can create duplicates or other repeated side effects.
- A repair can use current task settings, so preserve the settings and code revision used for the repair.

Preflight:

- identify partial target writes, checkpoints, watermarks, external calls, notifications, and file moves;
- decide whether overwrite, merge, deduplication, cleanup, or a bounded data correction is required;
- record the exact original run, repair run, tasks, parameters, data window, and revision;
- verify both job state and data outcome afterward.

Official source: [Troubleshoot and repair job failures](https://docs.databricks.com/aws/en/jobs/repair-job-failures).
