---
name: lineage-impact
description: Trace data lineage and change impact - what feeds a table, job, or dashboard, what breaks downstream if it changes or fails, and who uses it and must be told. Use for "what feeds X", "where does this number come from", "what breaks if I change or drop X", "who uses this table", blast radius of a failure, and impact checks before a schema or pipeline change. Read-only.
metadata:
  category: modular
---

# Trace lineage and impact

The result is a graph someone can check: every edge comes from a recorded source, every affected consumer has an owner or is marked as having none, and the people to tell are named.

## 1. Pin the asset and the question

Resolve the exact object (catalog.schema.table, job, view, dashboard, or column), its environment, and the direction asked: upstream (what feeds it), downstream (what reads it and would break), or both. For a proposed change, write down the change (rename, type change, drop, schedule move) because impact depends on it.

## 2. Collect lineage from recorded sources

Use what the platform records first, then fill gaps:

- Databricks Unity Catalog: `system.access.table_lineage` and `system.access.column_lineage` (entity type and id show the job, notebook, or pipeline that read or wrote).
- Snowflake: `ACCESS_HISTORY` (objects read and written per query) and `OBJECT_DEPENDENCIES` (views and other dependent objects).
- Other platforms: their lineage or dependency views, or the query log.
- Job and DAG definitions (job tasks, pipeline definitions, orchestration DAGs, dbt `ref`/`source`).
- Code search in the repositories for the table or column name.
- Knowledge: data definitions, system pages, consumer lists, and owners.

System lineage only covers what ran during its retention window and through supported paths; say where an edge came from and what could be missing (external tools, exports, BI extracts). Use `research` for current table names and fields.

## 3. Mark state and impact

For each node, record status when it matters: failing or stale (from run history or freshness), affected (downstream of the problem or the change), or ok. For a proposed change, decide per consumer whether it breaks, needs a change, or is unaffected, and why (it selects the column, it uses `SELECT *`, it only reads other columns).

Take owners from knowledge (system and people pages) or the platform's owner field. Never guess an owner from a name.

## 4. Show it

When the host offers `show_lineage`, draw the graph with it: the asset in focus, failing or stale nodes marked, affected nodes marked, owners on the nodes, and a note saying where the lineage came from. Otherwise draw a Mermaid `flowchart LR` from source to consumers, at most about 20 nodes, grouping the rest.

## 5. Answer

Lead with the answer in one sentence ("3 jobs and 2 dashboards read this column; 2 would break"). Then list the impacted consumers with owner and what each needs, and who to tell. Follow the [reply format](../orchestrate/references/reply-format.md). Making the change or notifying people is a separate request (`build`, `remediation`, `communication`).
