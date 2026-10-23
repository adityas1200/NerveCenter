# Data-level evidence

Use this when the symptom is in the data (stale, missing, partial, duplicated, or
wrong values), and always when a run reported SUCCESS but consumers see a
problem. Job metadata explains what the code did; only the tables show what
data resulted.

## Compare the layers

Run the read-only checks in the monitoring skill's data-level checks reference
(`skills/monitoring/references/data-level-checks.md`) for the affected window,
then go one step deeper:

1. Pin a version or timestamp for every table you read: last-good, first-bad,
   and current. State these in the evidence.
2. For the same keys, batch, or window, find the first layer where the data
   diverges from its upstream: missing rows, an older load timestamp, a marker
   that never arrived, or changed values.
3. Read that layer's table history around the run. Did the run commit a
   version? With what operation and row metrics? Was it an overwrite, a merge
   that matched nothing, or an empty append?
4. Tie the divergence to a mechanism: an unchanged watermark, an upstream table
   not refreshed before the read, a filter or join that dropped rows, a skipped
   task reported as success, a write to the wrong target, or a cache or view
   pointing at an old version.

A SUCCESS run that committed no new version, or wrote zero rows to a layer
that should have grown, is strong evidence. Say so explicitly.

## Preserve the evidence when it could be lost

Pinned reads are enough when the versions will still exist when someone reviews
the RCA. Evidence is at risk when:

- the next scheduled run will overwrite or append to the affected window;
- a remediation, backfill, or rerun is about to change the table;
- the pinned version is close to the end of time-travel retention, or a VACUUM
  is scheduled.

Then propose an evidence snapshot. It is a write, so check write policy in
`operations.yaml`, obtain approval when required, and show the exact statement
first:

```sql
-- Databricks: metadata-only copy of the pinned version
CREATE TABLE <evidence_schema>.<table>__ev_<ticket>_v<version>
  SHALLOW CLONE <catalog>.<schema>.<table> VERSION AS OF <version>;

-- Snowflake: zero-copy clone at the pinned point
CREATE TABLE <evidence_schema>.<table>__EV_<ticket>
  CLONE <db>.<schema>.<table> AT(TIMESTAMP => '<ts>'::timestamp_ltz);
```

Rules:

- Write only to the evidence or sandbox schema named in `operations.yaml` or
  knowledge. If none is named, ask; never create the snapshot next to the
  production table.
- Snapshot only the layers that hold the divergence, usually the last good
  layer and the first bad one. Do not clone the whole pipeline.
- A Databricks shallow clone does not copy data files; it references the
  source table's files. A VACUUM on the source can remove files the clone needs,
  depending on table type. Use `research` to confirm current behaviour. If the
  evidence must outlive the source's retention, propose a DEEP CLONE instead
  and state its storage cost.
- Read the snapshot back: row count and the key or marker query must match the
  pinned read on the source.
- Record in the ticket the snapshot name, source table, version or timestamp,
  why it was taken, and when it should be dropped.
- Dropping the snapshot is a separate write and follows the same approval. Never
  drop, vacuum, or alter the source as part of evidence handling.

The snapshot is for diagnosis only. Do not test fixes on it. Use the
remediation skill's clone-first validation for that.
