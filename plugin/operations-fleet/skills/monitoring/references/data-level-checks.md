# Data-level checks

A job or task SUCCESS means the code finished without raising an error. It does
not prove the run read new input, wrote the expected rows, or published them to
the layer consumers read. Stale, partial, or silently skipped data usually shows
up only in the tables.

All checks here are read-only. Use the warehouse or SQL connection with the
smallest scope that can read the tables, never a write path.

## When to run them

- Every data pipeline under review, including ones whose newest run succeeded.
- Before calling a pipeline healthy, recovered, or safe to close.
- When a consumer reports stale, missing, or wrong numbers and the jobs look green.

Get layer names, expected keys, markers, and freshness windows from
`operations.yaml` and approved knowledge. If they are not defined, infer them
from lineage and code, and state each inference as an assumption.

## The checks

Run each for the same batch, partition, or event-time window across every
layer, source -> bronze/raw -> silver/staging -> gold/target:

1. **Freshness.** The newest load or event timestamp in each layer, compared
   with the run time and the expected window. A target older than its upstream
   after a successful run is a failure.
2. **Write evidence.** Whether the run committed a new table version at all,
   and how many rows it wrote, from table history or operation metrics. A
   SUCCESS run with no new version, or zero output rows, needs an explanation.
3. **Layer counts.** Row counts for the window in each layer. Explain every drop
   or rise by a known filter, deduplication, or aggregation. An unexplained
   drop between two layers is a finding.
4. **Marker or key presence.** Pick the newest batch ID, load ID, business
   date, or a sample of keys from the source window and confirm they exist in
   each downstream layer. Report the first layer where they are missing.
5. **Shape sanity.** Null rate on key columns, duplicate keys, and distinct
   counts against the last good window. Keep this small; the full rules belong
   to data-quality checks.

Pin every read to the table version or timestamp you observed, so a later
reader can reproduce it and a new run does not change the answer under you.

## Databricks (Delta)

```sql
DESCRIBE HISTORY <catalog>.<schema>.<table> LIMIT 10;
-- version, timestamp, operation, operationMetrics.numOutputRows, job.runId

SELECT max(<load_ts>) AS newest, count(*) AS rows
FROM <table> VERSION AS OF <v>
WHERE <window_predicate>;

SELECT count(*) AS missing
FROM (SELECT <key> FROM <upstream> VERSION AS OF <v1> WHERE <window_predicate>) s
LEFT ANTI JOIN (SELECT <key> FROM <downstream> VERSION AS OF <v2> WHERE <window_predicate>) t
USING (<key>);
```

Match a history row to the run through `job.runId` or the commit timestamp.
Time travel only reaches versions inside the table's retention; record when the
evidence will expire.

## Snowflake

Use `INFORMATION_SCHEMA.TABLES.LAST_ALTERED` or `ACCOUNT_USAGE.TABLES` for
freshness, `QUERY_HISTORY` for the run's DML row counts, and
`AT(TIMESTAMP => ...)` or `BEFORE(STATEMENT => ...)` to pin reads within the
Time Travel retention.

## Reading the result

| Job status | Data checks | Verdict |
|---|---|---|
| SUCCESS | fresh, counts reconcile, markers present | healthy |
| SUCCESS | stale target, no new version, or markers missing | **silent data failure**: its own failure group, highest priority |
| SUCCESS | checks could not run | unverified: say so; do not report healthy |
| FAILED | any | failure; data checks show the exposure |

For a silent data failure, report the first layer where the data stops, the
pinned versions compared, and when the evidence expires. Hand to `rca`, which
decides whether the evidence needs preserving before the next run or retention
removes it. Monitoring does not create snapshots or change data.
