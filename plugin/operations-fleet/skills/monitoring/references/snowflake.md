# Snowflake monitoring

Retain account, region, database, schema, warehouse, task, query, and task-graph identity.

## Useful evidence

- `TASK_HISTORY` for schedule, state, attempt, query ID, condition text, configuration, and completion.
- Query history for SQL text or hash, role, warehouse, compilation, execution, queueing, bytes, rows, and error details.
- Task dependencies and graph run identity.
- Warehouse events, resource monitors, credit usage, and concurrency or queueing.
- Access history and object dependencies where available.
- Data metric function results or client DQ tables.

## Important cautions

- Information Schema and Account Usage views can have different retention and latency.
- A task may be scheduled, queued, skipped, running, failed, or cancelled; do not collapse states.
- Match a task execution to its query using the provider query ID when present.
- Qualified names and active role matter when resolving objects.

Official sources:

- [TASK_HISTORY table function](https://docs.snowflake.com/en/sql-reference/functions/task_history)
- [Query history](https://docs.snowflake.com/en/sql-reference/functions/query_history)
- [Task graphs](https://docs.snowflake.com/en/user-guide/tasks-graphs)
