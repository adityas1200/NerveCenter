---
id: SPEC-data-quality-03
title: DDL analysis and column mapping (with optional agent assist)
status: implemented
area: data-quality
owners: []
code:
  - backend/src/data-quality/ddl-mapping.mjs
  - backend/src/data-quality/ddl-mapping-agent.mjs
  - backend/src/data-quality/data-quality-service.mjs
  - backend/src/api/server.mjs
  - frontend/src/components/ops/MonitoringTableConfigurationDialog.tsx
last_verified: 2026-10-11
---

# DDL analysis and column mapping (with optional agent assist)

## Purpose
Turn a pasted `CREATE TABLE/VIEW` statement for a client's DQ result table into a validated mapping from canonical fields (checkId, status, executedAt, ...) to the table's real columns, so non-standard tables can be monitored without code changes.

## Scope
- In scope: `parseDdl`, `deriveMapping`, `validateMapping`, `analyzeDdl`, `DataQualityService.analyzeConfig`, `DdlMappingAgent`, `POST /api/data-quality/analyze`.
- Out of scope: persisting the mapping (SPEC-data-quality-01), reading results (SPEC-data-quality-02).

## Actors and permissions
`POST /api/data-quality/analyze` requires `project.settings` for the selected project.

## Requirements
- **FR-1** The DDL SHALL be one `CREATE [OR REPLACE] [TEMP[ORARY]] TABLE|VIEW` statement of at most 100,000 bytes with a parenthesised column list; otherwise it SHALL be rejected with a specific message. Empty DDL at the API edge SHALL return 400, and the editor SHALL disable Analyze until DDL is entered.
- **FR-2** Parsing SHALL strip comments, split top-level commas (respecting parentheses and quotes), skip constraints/partition/cluster/policy clauses and computed `AS (...)` entries, and return per column `name, normalizedName, type, nullable, comment`.
- **FR-3** Duplicate normalised column names, a DDL table name differing from `resultTable`, or a DDL schema differing from `schema` SHALL be reported as issues; `saveConfig` SHALL reject on "does not match" or "duplicate column".
- **FR-4** `deriveMapping` SHALL map each canonical key to the single column matching its alias list (e.g. `checkId`: check_id, rule_id, id, ...; `executedAt`: executed_at, run_at, created_at, timestamp, ...); several matches SHALL produce no mapping and an issue listing candidates; a missing required key (`checkId`, `status`, `executedAt`) SHALL be an issue.
- **FR-5** `validateMapping` SHALL require each target column to exist in the DDL, `executedAt` to be a date/time type, `failedRows` numeric, and all three required keys present; it returns cleaned mapping with DDL-cased names.
- **FR-6** `analyzeConfig` SHALL require a connected provider. When a required key is unmapped or any key is ambiguous it SHALL call the mapping agent; the agent's mapping SHALL be merged over the deterministic one and re-validated, so it cannot introduce a column not in the DDL.
- **FR-7** The agent SHALL run only when `ANTHROPIC_API_KEY` is set and the Claude Agent SDK loads; otherwise `{used:false, reason}`. It SHALL be single-turn, tool-less, budget-limited (`OPS_DQ_MAPPING_MAX_BUDGET_USD`, default 0.08; model `OPS_DQ_MAPPING_MODEL`) and return JSON `{mapping, confidence, issues}`.
- **FR-8** A sample of up to 5 rows (40 columns each) SHALL be read and sent to the agent only when the caller sets `allowDataSample`, the API key is set, and an agent is needed; a read failure SHALL become an issue, not an error.
- **FR-9** The response SHALL include `columns, mapping, candidates, issues, missingRequired, confidence` (agent's, else mapped/total keys), `ddlHash` (sha256), `agent{used,reason}`, `sample{used,rowCount}`.

## Scenarios
### S1 Canonical names
- **Given** DDL with `check_id, status, executed_at` **Then** mapping complete, `agent.used:false` ("matched the canonical DQ names").
### S2 Ambiguous
- **Given** both `id` and `check_id` **Then** issue "checkId has more than one possible column" and the agent (if available) chooses.
### S3 Wrong type
- **Given** `executedAt` mapped to a STRING column **Then** issue "unexpected type".
### S4 No API key
- **Then** deterministic result only, `agent.reason: 'ANTHROPIC_API_KEY is not configured'`.

## Interfaces
- `POST /api/data-quality/analyze` body `{provider, catalog, schema, resultTable, warehouseId?, ddl, allowDataSample?}` -> analysis above.
- Config: `OPS_DQ_MAPPING_MODEL`, `OPS_DQ_MAPPING_MAX_BUDGET_USD`, `ANTHROPIC_API_KEY`.
- Stored on the table: `ddl, ddlHash, discoveredColumns`.
- UI: result-table editor (paste DDL, review mapping, save).

## Non-functional constraints
- Parser never executes the DDL; sample SQL is `SELECT * ... LIMIT 5` with validated identifiers.
- Agent prompt includes DDL (truncated to 100k chars) and optionally sample rows; data leaves the deployment to the model API only on explicit opt-in.

## Known gaps / deviations
- The route's empty-DDL response has a backend regression test; parser, `analyzeConfig`, and the agent have no direct backend tests.
- Parser is regex-based; exotic DDL (nested types with commas inside generics without parentheses, Snowflake `IDENTITY`, Databricks `GENERATED`) may mis-parse silently.
- Agent `confidence` is trusted after clamping; the deterministic path reports ratio mapped, which can read 1.0 with ambiguity resolved only by the agent.
- Mapping save accepts an externally supplied mapping that is re-validated only if DDL is also supplied; without DDL only identifier syntax is checked.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `backend/src/data-quality/ddl-mapping.mjs`; `backend/src/api/server.mjs`; `frontend/src/components/ops/MonitoringTableConfigurationDialog.tsx` | `backend/tests/dq-analyze-validation.test.mjs`; `frontend/src/components/ops/MonitoringTableConfigurationDialog.validation.test.tsx` |
| FR-2 | `ddl-mapping.mjs:36-108` | none |
| FR-3 | `ddl-mapping.mjs:124-128`; `data-quality-service.mjs:59` | none |
| FR-4 | `ddl-mapping.mjs:14-26,137-149` | none |
| FR-5 | `ddl-mapping.mjs:151-172` | none |
| FR-6 | `data-quality-service.mjs:76-87` | none |
| FR-7 | `backend/src/data-quality/ddl-mapping-agent.mjs:20-54` | none |
| FR-8 | `data-quality-service.mjs:81,143-149`; `ddl-mapping-agent.mjs:14-17` | none |
| FR-9 | `data-quality-service.mjs:85-86` | `frontend/src/features/data-quality/DataQualityPage.test.tsx:70` (mocked) |

## Open questions
- Restrict `analyze` to admins?

## Manual refresh amendment (approved 2026-10-13)

Browser polling, focus/reconnect refetch and live task streaming are superseded by [Manual browser refresh](../platform/manual-refresh.md). Navigation, selection changes, explicit Refresh and affected user writes load data. Server jobs and APIs remain available.
