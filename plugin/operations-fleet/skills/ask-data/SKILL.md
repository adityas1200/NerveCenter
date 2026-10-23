---
name: ask-data
description: Answer a business question about data the way a data analyst would - map the terms to approved definitions, find the right tables, write one read-only SELECT, sanity-check the result, and reply with the number first. Use for "how many", "what were sales last week by region", "which customers", "what is the trend", or any question whose answer is a number, a short list, or a small table in the reply. When the person wants a file to keep, share, or send, use data-pull instead.
metadata:
  category: sequential
---

# Answer a data question

The answer is right when the number matches the approved definition, covers the whole window asked about, and someone can rerun the query and get the same result. The work is read-only.

## 1. Pin the question

Resolve the measure, grain, filters, time window, and timezone. Map each business term ("active customer", "net sales", "region") through knowledge: data definitions, approved tables or views, standard exclusions such as test accounts. Prefer the curated object knowledge names over raw tables. When a term has no definition and two readings give different numbers, ask which one is meant, or answer both and say so.

Resolve the data-sharing rules from knowledge: which columns are sensitive and who may see them. Never return personal or restricted values the asker may not see; aggregate or leave them out and say why.

## 2. Find the data

When the host offers `describe_board_data`, use it to list tables and read real column names, types, and comments. Otherwise read the platform's `information_schema` (or equivalent catalog). Check the table's latest load time before trusting it.

## 3. Write one query

- One `SELECT` (or `WITH ... SELECT`). No writes, no temporary tables.
- Bind values as parameters; never splice user text into the statement.
- Filter on the partition or time column, select only needed columns, aggregate in the database, and keep results small (`LIMIT`).
- Run it with `query_data` when the host offers it, otherwise through the platform's read-only SQL path.

## 4. Sanity-check before answering

- The window is complete: the last day or hour has loaded.
- Row counts and totals are plausible against the prior period; explain a large jump or say it is unexplained.
- No duplicate keys at the stated grain, and joins did not multiply rows.
- Nulls or unmapped values that change the answer are counted and mentioned.

## 5. Answer

Lead with the number or the short answer, its unit, window, and source table in one sentence. When the host offers them, show headline numbers with `show_metrics` and rows with `show_table`; otherwise use a small markdown table. Add a caveat only when a check above found something. Follow the [reply format](../orchestrate/references/reply-format.md) for a quick question: no headings, no file.

Show the SQL when asked. Offer one concrete next step when it fits: save the query as a board widget, turn it into a data pull (`data-pull`) for a file, or schedule it as a routine (`workflow`).
