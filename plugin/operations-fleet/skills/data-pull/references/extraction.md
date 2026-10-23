# Extraction details

## Defaults when knowledge is silent

Knowledge and `operations.yaml` override every default here.

- Confirm with the requester before extracting more than 1,000,000 rows or more than 100 MB.
- Treat a column as sensitive when its name, tag, or classification suggests a person: name, email, phone, address, date of birth, national or employee ID, patient or prescriber ID, or free-text notes.
- Send files only to recipients inside the organization's own mail domains.
- Keep extracts in the task folder. Do not copy them to shared locations unless asked.

## Databricks

- Run queries through the SQL Statement Execution API (`POST /api/2.0/sql/statements`) or the configured MCP, with `warehouse_id` and named parameters (`:start_date`).
- Use `disposition: INLINE` for small results. For large results use `disposition: EXTERNAL_LINKS` with `format: CSV`, fetch each chunk from `/result/chunks/{n}`, and download the presigned links without the workspace token.
- Poll a pending statement by `statement_id`. Cancel it if you abandon it.
- Check freshness with `DESCRIBE DETAIL` or `DESCRIBE HISTORY`. Read column classifications from `information_schema.column_tags`.

Confirm current limits and fields in the [Statement Execution API reference](https://docs.databricks.com/api/workspace/statementexecution).

## Snowflake

- Use the configured connector or MCP with bound parameters. Masking and row access policies apply to the session role, so name the role you used in the query file.
- Read classifications with `SYSTEM$GET_TAG` or the `TAG_REFERENCES` table function, and freshness from `LAST_ALTERED` in `INFORMATION_SCHEMA.TABLES`.
- For large results, fetch in batches from the connector. `COPY INTO @stage` writes to a stage and needs approval under the write policy.

See [Snowflake object tagging](https://docs.snowflake.com/en/user-guide/object-tagging).

## Other sources

Use the connection that `operations.yaml` names and the access pattern the knowledge concept for that source describes. Apply the same rules: read-only, parameterized, filtered, a saved query, and a profiled file.
