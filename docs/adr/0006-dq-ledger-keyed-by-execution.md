# 0006. DQ ledger rows keyed by execution

- Status: proposed
- Date: 2026-10-06
- Related: ADR 0002 (supersedes its `ops_dq_results` key), specs/data-quality/dq-monitor.md (SPEC-data-quality-02), specs/automations/auto-investigation.md (SPEC-automations-01)

## Context
- ADR 0002 keys `ops_dq_results` by the failure `sourceRef` (`#failureSourceRef` in `data-quality-service.mjs`). That hash covers the table, check id, `executedAt` and `status`, plus `message` when there is no `executedAt`. It was built to link a failure to its ticket, not to name a row.
- When the source updates a result in place (the same check and run time, `running` to `failed`, or re-marked), the key changes, the upsert misses and the ledger gains a second row. The stale row stays: the Data Quality page and Sonic (`data_quality_results`, `app_overview`) count both.

## Decision
1. The ledger key is `dqResultKey({ tableId, checkId, executedAt })`: `dq-result:` plus the first 40 hex characters of SHA-256 over the three values joined by U+001F. A re-fetched execution overwrites its row. Results with no `executedAt` keep one row per check, the latest.
2. `sourceRef` (ticket links) is unchanged.
3. Detector occurrences stay `dq:<result key>`, so one execution is alerted once whatever its status changes, as long as it is failing when first seen.
4. Migration `011-dq-result-key.sql` re-keys existing rows with the same formula in SQL (`sha256`, Postgres 11+). Duplicates keep the newest `updated_at`. Claimed occurrences and alert occurrences (`resultKey`, `key`) follow the new key, so failures already acted on are not alerted again. The file-store twin `011-dq-result-key.mjs` does the same for `monitoring/<projectId>/{dq,occurrences,alerts}.json`. Both are safe to run twice.

## Alternatives considered
- Leave status in the key and delete older rows for the same execution at fetch time: two writes per row, and the key still does not name what it stores.
- Key on the source's own row id: result tables have no common one, and the mapping has no column for it.

## Consequences
- The page and Sonic show one row per execution, with its latest status.
- If a source writes several rows for the same check and run time (one per partition, say), they now collapse to one, the last fetched. The mapping would need a new column to tell them apart.
- `tableId` identifies the table. Repointing a configured table to another source under the same id merges their history.
- Rollback: forward-only. Reverting the code without a new migration makes the next fetch write old-style keys beside the new ones, which duplicates rows until they age out.
