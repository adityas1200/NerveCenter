# Infrastructure causes

A pipeline can fail with correct code and correct data because the compute under it changed or broke. Test these hypotheses alongside code and data, from the platform's own APIs and system tables. No cloud-provider connector is needed: the data platform records what it asked for and what it got.

## What to check

Compare the first bad run with the last good one for each item.

| Cause | Typical signal |
|---|---|
| Cluster or warehouse configuration changed | Different node type, size, worker count, policy, or warehouse size between runs |
| Too little capacity | Out-of-memory on the driver or executors, disk spill, long queueing, warehouse at max clusters |
| Autoscaling limits | Workers capped at the maximum while tasks wait, or slow scale-up at the start |
| Spot or preemptible capacity lost | Nodes lost mid-run, executor lost or decommissioned events, retries on new nodes |
| Runtime or engine version changed | A new runtime, engine, or channel version on the first bad run; deprecation errors |
| Library conflict | Import or class-not-found errors, a library version changed or unpinned, install failures |
| Init or startup script failed | Cluster start failures, init-script logs with errors, timeouts before the first task |
| Credentials or permissions expired | 401/403, token or secret expiry, service principal or role changed, storage access denied |
| Quota or limit reached | Cloud or account quota errors, concurrency limits, resource monitor suspended the warehouse, capacity not available in the region |

## Where the platform records it

- Databricks: the run's cluster spec and cluster events (Clusters API events, `system.compute.clusters`, `system.compute.node_timeline`), job and task run details (`system.lakeflow.*`), audit logs (`system.access.audit`) for configuration, permission and token changes, warehouse events for SQL failures, and the driver and init-script logs.
- Snowflake: `QUERY_HISTORY` (queueing, spill, warehouse size), `WAREHOUSE_EVENTS_HISTORY` and `WAREHOUSE_LOAD_HISTORY`, resource monitors, `LOGIN_HISTORY` and grant history for credential or role changes, and task history.
- Other platforms: the equivalent run configuration, compute event log, audit log, and quota page. Use `research` for current table names and fields; they change.

## Reasoning

- A configuration change between last good and first bad is a strong lead, not proof. Tie it to the failure mechanism (for example, smaller nodes and a driver out-of-memory error on the same stage).
- Transient infrastructure failures (one spot loss, one quota blip) usually pass on retry; a repeated one with the same signal is a durable cause.
- When the infrastructure was unchanged and healthy, say so and record it as ruled out.
- Changing compute is a remediation, not part of the RCA.
