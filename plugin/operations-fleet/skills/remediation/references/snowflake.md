# Snowflake recovery

Choose recovery based on task, stream, table, dynamic table, warehouse, and transaction state.

Check:

- exact task graph run and query IDs;
- predecessor completion and stream offsets;
- whether the failed statement committed, rolled back, or partially affected external systems;
- task suspension, retry, timeout, and overlapping-execution settings;
- query idempotency and whether rerunning will append, merge, overwrite, or call an external function;
- target partitions and downstream tasks or consumers;
- role, warehouse, and session settings used for recovery.

For data correction, define the exact row set and a reversible or compensating plan. Compare before and after counts, key uniqueness, control totals, and downstream freshness.

For a material table change, validate on a zero-copy clone first
(`CREATE TABLE <clone> CLONE <source>`; see [clone-first validation](clone-first-validation.md)). Clone validation is not production
approval: the source change remains a separate approved write, followed by
independent verification and explicit clone cleanup. This is table-only and does
not clone tasks, streams, permissions, schedules, or external side effects.

Official sources:

- [Task history](https://docs.snowflake.com/en/sql-reference/functions/task_history)
- [Introduction to tasks](https://docs.snowflake.com/en/user-guide/tasks-intro)
- [Transactions](https://docs.snowflake.com/en/sql-reference/transactions)
