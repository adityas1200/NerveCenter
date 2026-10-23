# 0007. DQ ledger mirrors the source result table

- Status: accepted (2026-10-07)
- Date: 2026-10-07
- Related: ADR 0002 (changes its DQ fetch), ADR 0006, specs/data-quality/dq-monitor.md (SPEC-data-quality-02 FR-14..FR-16), specs/platform/fetch-cadence.md (SPEC-platform-10 FR-4)

## Context
- The background fetch reads each DQ result table from its cursor less a 2-hour overlap and upserts into `ops_dq_results`. It never removes a row, so a row the source deletes or overwrites stays for `retainDays` (60).
- On 2026-10-07 `deploy_agent_testing.dq_control_commercial.dq_run_summary` held 123 rows, all from its 2026-10-06 run. The ledger held 937 for that table (836 in the last 7 days): the 6 Oct batch plus the batches from 30 Sep to 5 Oct, which the source had since overwritten. There were no duplicates; the extra rows were history the source no longer had.
- Users read the Data Quality page as the result table. The team wants it to match the table, and production tables are rarely truncated, so mirroring rarely costs history in practice.
- The page re-reads every 60 s but the fetch runs every 15 min, so new rows can take up to 15 min to appear.

## Decision
1. **Full-window read.** Each DQ fetch reads every enabled table over the whole retention window (`now - retainDays`), not from the cursor. The 10,000-row cap per table stays.
2. **Replace per table.** For each table that was read successfully, the fetch upserts the rows it got and deletes that table's ledger rows in the window that it did not get. Upsert and delete run in one transaction, so a reader sees the old set or the new one, never a mix.
   - If a table hits the 10,000-row cap, only rows at or after the oldest row returned are replaced; older rows are left alone.
   - A table that cannot be read (FR-7) is left untouched. A read that succeeds with 0 rows clears that table.
   - Paused or removed tables are not touched; reads already filter them out.
3. **On-view refresh.** The Data Quality page calls `POST /api/monitor/refresh` with `sources: ['dataQuality']` when it opens and on each 60 s tick, then re-reads. A data-quality-only refresh runs under the project that owns the shared tables (SPEC-platform-10 FR-9), so the page works from any project. It has its own 30 s throttle (429, ignored by the page), kept apart from the Pipelines refresh, which caps it at about two warehouse reads a minute however many people are watching. A read still in flight when the fetch ends is cancelled so the re-read sees the new rows. The background cadence still runs for alerts when nobody is watching.
4. **Alerts are unaffected.** Occurrences live in `ops_alert_occurrences` and alerts keep their own copy, so a deleted failure is not alerted again, and an open alert stays open until a later passing run (`dqRecovered`).
5. **File store** does the same on `monitoring/<projectId>/dq.json`. There is no schema change and no migration. The first fetch after deploy removes the rows the sources no longer have.

## Alternatives considered
- **Read the source live on every page view (no ledger):** loses ledger keys, ticket and investigation links, paging and alert memory, and runs one warehouse query per viewer per minute.
- **Keep the history but show the latest per check:** doesn't make counts match the table, which is what was asked.
- **Mirror only the page's window:** the window changes with each view, so the ledger would disagree with itself.
- **Shorten the background cadence to 60 s:** keeps the warehouse warm all day, even when nobody is looking.

## Consequences
- Counts and rows on the page match the result table in the window, at most about 30 s behind while someone is watching.
- History the source drops is gone from NerveCenter. Trends and "what failed last Tuesday" work only as far back as the source keeps data. Tickets and investigations keep their own record but no longer link to a row.
- Each fetch reads up to 10,000 rows per table instead of only new ones: more warehouse time per fetch. With on-view refresh that happens up to twice a minute while anyone has the page open.
- Pipeline runs keep incremental fetching (FR-4 unchanged for them).
- Rollback: revert the code. Nothing to migrate back; the ledger simply stops deleting from then on.
