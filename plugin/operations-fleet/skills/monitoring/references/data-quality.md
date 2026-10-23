# Data-quality signal review

A failed rule is a symptom until its definition, evaluated population, and business meaning are understood.

Capture:

- rule or expectation ID and exact definition;
- dataset, columns, partition, batch, and event-time window;
- evaluation time and timezone;
- observed value, threshold, comparator, and severity;
- denominator and excluded records;
- previous values and normal range;
- sample failing records with sensitive fields minimized;
- upstream load and schema state;
- downstream consumers and freshness requirements.

Distinguish:

- a genuine source-data defect;
- an ingestion or transformation defect;
- a late or incomplete batch;
- a rule, threshold, or denominator change;
- schema or type drift;
- duplicate processing;
- monitoring failure.

Do not infer business impact from rule severity alone. Use approved domain knowledge and lineage.

Platform sources:

- [Databricks expectations](https://docs.databricks.com/aws/en/ldp/expectations)
- [Snowflake data metric functions](https://docs.snowflake.com/en/user-guide/data-quality-system-dmfs)
