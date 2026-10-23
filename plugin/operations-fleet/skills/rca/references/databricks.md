# Databricks RCA evidence

Start at the failed task, not only the parent job status.

Check:

- workspace, job, job run, task run, attempt, and repair IDs;
- code source and exact revision or notebook state;
- job and task settings in effect for the failed attempt;
- parameters, cluster or serverless environment, libraries, runtime, and permissions;
- task output, Spark or SQL errors, driver and executor signals, query profiles, and event logs;
- last-good and first-bad input partitions and schemas;
- partial target writes, checkpoints, and watermark state;
- Delta history (`DESCRIBE HISTORY`) of each layer the run wrote, and pinned `VERSION AS OF` reads comparing the same window across layers, even when the run reported SUCCESS (see [data-level evidence](data-level-evidence.md));
- upstream arrivals and downstream lineage;
- recent code, configuration, runtime, policy, and infrastructure changes.

A later repair can run with current task settings, which may differ from the original attempt. Preserve both when explaining causality.

Official sources:

- [Troubleshoot and repair job failures](https://docs.databricks.com/aws/en/jobs/repair-job-failures)
- [Jobs system tables](https://docs.databricks.com/aws/en/admin/system-tables/jobs)
- [Jobs API run model](https://docs.databricks.com/api/workspace/jobs)
