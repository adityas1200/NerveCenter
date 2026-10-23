---
id: SPEC-data-quality-01
title: Data quality result-table configuration
status: implemented
area: data-quality
owners: []
code:
  - backend/src/data-quality/data-quality-service.mjs
  - backend/src/app/operations-store.mts
  - backend/src/app/rbac.mjs
  - backend/src/api/server.mjs
  - frontend/src/api/data-quality.ts
last_verified: 2026-10-06
---

# Data quality result-table configuration

## Purpose
Let an administrator point NerveCenter at one or more client-owned DQ result tables (Databricks or Snowflake), with a column mapping, so the Data Quality page reads real check results.

## Scope
- In scope: list/save/delete of result tables, provider availability, legacy single-config migration, validation.
- Out of scope: DDL analysis (SPEC-data-quality-03), reading results (SPEC-data-quality-02), the result-table editor UI internals.

## Actors and permissions
- Read (`GET providers`, `GET config`): any role.
- Write (`POST|PUT /api/data-quality/config`) and `DELETE /api/data-quality/config/:id`: admin only (`rbac.mjs:61` and `assertAdmin` at `server.mjs:71`).

## Requirements
- **FR-1** Tables SHALL be stored as `{tables:[...]}` per project in the operations store: `ops_data_quality_configs (project_id, data)` in Postgres, `dataQuality[<projectId>]` in the file store (ADR 0004); no project means PILOT. A stored single object with `provider` or `resultTable` SHALL be read as a one-table list with id `dq-1`; missing ids become `dq-<n>`, missing names default to `resultTable`, `enabled` defaults true; the shape is rewritten on next save.
- **FR-2** `providers()` SHALL list providers (`databricks`, `snowflake`) that are `available`, `ready`, and either deployment-sourced or `verified === true`.
- **FR-3** `saveConfig` SHALL create a table (new id `dq-<8 hex>`) or update by `id`, merging a partial patch over the stored table; provider SHALL be `databricks|snowflake`.
- **FR-4** Enabling or creating a table SHALL require its provider to be in `providers()`; pausing (`enabled:false`) SHALL work with the connection down.
- **FR-5** `catalog`, `schema`, `resultTable`, optional `ruleTable` SHALL match `[A-Za-z0-9_$-]{1,255}`; Databricks SHALL require `warehouseId`; `name` is truncated to 120.
- **FR-6** Mapping SHALL be validated against the DDL when supplied (SPEC-data-quality-03); without DDL each key SHALL come from the patch or `DEFAULT_MAPPING` with `checkId`, `status`, `executedAt` required.
- **FR-7** Two tables with the same provider and `catalog.schema.resultTable` (case-insensitive) SHALL be rejected, naming the existing table.
- **FR-8** `deleteConfig` SHALL remove one table by id, returning `{id, deleted:true}`; an unknown id SHALL be 404 "Result table not found".
- **FR-9** `getConfig()` SHALL return the first enabled table, else the first table, else null; `GET /api/data-quality/config` returns `{configuration, tables}`.

## Scenarios
### S1 Migrate legacy
- **Given** stored `{provider:'databricks', resultTable:'dq_results', ...}` **Then** `listTables()` returns one table `dq-1`.
### S2 Add second table
- **Given** one table **When** saving a Snowflake table without `id` **Then** two tables exist; saving with the first id updates it in place.
### S3 Viewer deletes
- **When** non-admin calls `DELETE /api/data-quality/config/dq-1` **Then** 403; admin on unknown id gets 404.
### S4 Disconnected provider
- **When** enabling a table whose connection is not ready **Then** error "Select a connected Databricks or Snowflake provider".

## Interfaces
- `GET /api/data-quality/providers` -> `{items:[{id,name,source,profileId}]}`
- `GET /api/data-quality/config` -> `{configuration, tables}`
- `POST|PUT /api/data-quality/config` body `{id?, name, provider, catalog, schema, resultTable, ruleTable?, warehouseId?, mapping?, ddl?, discoveredColumns?, enabled?}` -> saved table (`+ ddl, ddlHash, discoveredColumns` when DDL given)
- `DELETE /api/data-quality/config/:id`
- Stored fields: `id, name, provider, catalog, schema, resultTable, ruleTable, warehouseId, mapping, enabled, updatedAt`.
- UI: Data Quality page menu "Edit result table / Add result table / All result tables" (-> `/settings?tab=data-quality`).

## Non-functional constraints
- Saves are read-modify-write of one setting with no locking; last writer wins.
- Identifiers validated before interpolation into SQL (SPEC-data-quality-02 quotes them).

## Known gaps / deviations
- `POST /api/data-quality/analyze` is not admin-only (see SPEC-data-quality-03).
- Name/ID collisions: client-supplied `id` for a non-existent table is accepted as the new id.
- No audit entry on save/delete.
- `ruleTable` must reuse the same column names as the result mapping (SPEC-data-quality-02).
- Save validation errors return HTTP 400; there is no 409 for duplicates.
- Notifications warn "Data quality result table not set up" when `getConfig()` is null or disabled (`operations-service.mjs:210`); not covered by tests.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/data-quality/data-quality-service.mjs:34-38` | `backend/tests/data-quality.test.mjs:44` |
| FR-2 | `data-quality-service.mjs:44` | none |
| FR-3 | `data-quality-service.mjs:50-70` | `data-quality.test.mjs:58` |
| FR-4 | `data-quality-service.mjs:56-57` | none |
| FR-5 | `data-quality-service.mjs:15,62-64` | none |
| FR-6 | `data-quality-service.mjs:58-61` | none |
| FR-7 | `data-quality-service.mjs:65-66` | none |
| FR-8 | `data-quality-service.mjs:71-75`; `backend/src/api/server.mjs:71` | `data-quality.test.mjs:77`; `backend/tests/data-quality-api.test.mjs:19` |
| FR-9 | `data-quality-service.mjs:47-48`; `server.mjs:68` | `data-quality-api.test.mjs:19` |

## Open questions
- Should analyze/sample require admin since it can read warehouse rows?
