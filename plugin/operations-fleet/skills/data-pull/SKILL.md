---
name: data-pull
description: Pull data from a warehouse, lakehouse, or reporting system into a checked CSV file with its saved query and profile. Use when the deliverable is a data file - "pull", "extract", "export", "send me the data", "get me the list of" records for someone to work with or receive. For a question answered with a number or a small table in the reply, use ask-data instead.
metadata:
  category: sequential
---

# Pull data

A pull is correct when someone else can rerun the saved query and get the same rows, and nothing leaves that the data-sharing rules do not allow. The work is read-only.

When the host offers `describe_board_data` and `query_data`, use them for the inspection in step 2 (table and column discovery, the count, the sample, the window check) and for the reconciliation queries in step 5. `query_data` returns only the first rows, so extract the full file through the platform's bulk path. Show the preview with `show_table`, the totals with `show_metrics`, and a report with `show_artifact` when it offers those.

## 1. Resolve the request

Pin down the business question, the grain (one row per what), measures, filters, time window and timezone, output columns, and who will receive the file.

Map business terms to sources through knowledge: approved tables or views, metric definitions, join keys, and standard exclusions such as test accounts. Prefer the curated object that knowledge names over raw tables. When a term has no definition and two readings give different numbers, ask which one is meant.

Resolve the data-sharing rules from knowledge: sensitive columns and their classification, which audiences may receive which data, masking, and row or size limits. When knowledge sets none, apply the defaults in [extraction](references/extraction.md) and say that you did.

## 2. Inspect before extracting

- Describe the object: columns, types, partition or cluster keys, latest load time, and approximate size.
- Run a count and a ten-row sample with the exact filters.
- Check that the window is complete, for example that the last day has loaded, and that the count is plausible against the previous period.
- Use `SELECT` or `WITH` only. Filter on the partition or time column, select only the columns needed, and pass values as parameters.

## 3. Protect sensitive data

Leave out or mask every column the rules classify as sensitive, unless the rules allow this recipient to receive it. If the request needs such a column and no rule allows it, stop and ask for approval that names the exact columns and recipient. If the recipient is outside the allowed audience, do not produce the file.

## 4. Extract

- Save the exact query as `<name>.sql` beside the output. Start it with a comment giving the source, window, timezone, run time, and requester.
- Write UTF-8 CSV with a header row, ISO 8601 dates, `.` as the decimal separator, no thousands separators, and no index column.
- Use the platform's bulk result path for large results. See [extraction](references/extraction.md).
- Name files by purpose and window, such as `territory-sales-2026-W38.csv`.

## 5. Check the file

Run `python <this skill's folder>/scripts/profile_csv.py <file.csv> --key <grain columns>`. It writes `<file>.profile.json` with row count, per-column nulls, ranges, numeric totals, duplicate keys, column names that look personal, size, and SHA-256. Then confirm:

- the row count matches a `COUNT(*)` of the same query in the source;
- the main totals match an independent `SUM` in the source, or the difference is explained;
- there are no duplicate keys at the stated grain;
- every date falls inside the requested window;
- no sensitive column is present.

Fix a failed check, or report it in the reply. Never deliver a file that failed a check without saying so.

## 6. Deliver

Reply with a headline giving the row count, window, and source. Add a preview of up to ten rows or the summary totals, one line per check with its result, and links to the CSV, the query, and the profile.

To send the file, pass `communication` its exact path and SHA-256 from the profile. Put the summary totals in the email body, never raw rows. When the file is over the attachment limit, publish it through `documents` and send the link instead.

A pull that must repeat on a schedule becomes a `workflow`.
