# Snowflake RCA evidence

Check:

- account, region, task graph, task, scheduled time, attempt, and query ID;
- exact query text or hash, role, warehouse, database, schema, and session settings;
- task condition, predecessor state, return values, and graph configuration;
- compile, queue, execution, spill, scan, and error information;
- warehouse availability, size, concurrency, resource monitors, and credit state;
- data arrival, object changes, schema drift, permissions, and recent deployments;
- last-good and first-bad query profiles and inputs;
- downstream tasks, streams, dynamic tables, and consumers.

Account Usage data can arrive later than Information Schema data. Record the source and extraction time of every timeline statement.

Official sources:

- [TASK_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/task_history)
- [QUERY_HISTORY](https://docs.snowflake.com/en/sql-reference/functions/query_history)
- [Query profile](https://docs.snowflake.com/en/user-guide/ui-query-profile)
