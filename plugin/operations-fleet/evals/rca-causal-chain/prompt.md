---
max_turns: 6
allowed_tools: [Skill]
---
A Databricks job has three tasks: ingest, transform, and publish. The parent job is failed. The ingest task wrote 18,429 rows, then its driver timed out before the watermark update committed. Transform and publish were skipped. A repair reran ingest with append behavior and the DQ uniqueness check failed. Source files contain no duplicate business keys, and there was no code or configuration change between the last good and first bad run.

Explain the root cause, impact, competing explanations, confidence, and the correct next type of action. Do not perform a repair.
