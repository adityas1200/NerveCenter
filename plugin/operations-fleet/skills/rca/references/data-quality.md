# Data-quality RCA

A DQ RCA must explain both the failed measurement and the production mechanism behind it.

1. Reconstruct the evaluated population and rule logic.
2. Quantify the failing records and distribution, not just the count.
3. Compare source, staging, transformed, and target states for the same keys and window.
4. Check missing or late inputs, schema and type changes, joins, filters, deduplication, aggregation, defaults, timezone, and replay.
5. Determine whether the rule changed, the data changed, or the evaluation itself malfunctioned.
6. Trace downstream exposure and whether consumers actually read the affected window.
7. Preserve representative examples with sensitive fields removed.

Common causal paths include partial loads, non-atomic watermark changes, replayed append writes, late data, incorrect join cardinality, schema drift, stale reference data, and a threshold that no longer reflects the business definition.
