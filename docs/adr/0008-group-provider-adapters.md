# 0008. Group provider adapters by connector

- Status: accepted
- Date: 2026-10-11
- Related: docs/code-review/README.md (CR-18), specs/connectors/connection-profiles.md

## Context

Provider clients are split among `backend/src/platform/`, `backend/src/jira/`, and `backend/src/servicenow/`. Shared connection profiles, project grants, secret storage, and connector setup belong to separate services. The team wants a predictable place to find code that talks to each external provider. The TypeScript build root is `backend/src`, so a top-level `backend/connectors` directory would sit outside it.

## Decision

Move the Databricks, Snowflake, Jira, and ServiceNow provider clients into `backend/src/connectors/<provider>/`. Keep Snowflake metadata with its query client. Update imports directly and remove the old provider file paths. Keep generic connection profiles, secret storage, connector orchestration, and data platform coordination in their existing domain modules. Keep `platform/databricks-app.mjs` in `platform/` because it represents the hosting environment and Lakebase credentials, not a customer connection profile. The move must not change API behavior or stored data.

## Alternatives considered

- Move every connection and secret service into each provider directory: duplicates cross-provider lifecycle and project-grant logic.
- Put the directories at `backend/connectors/`: outside the current build root.
- Add re-export files at the old paths: preserves duplicate locations and hides stale imports.

## Consequences

Provider code has one discoverable directory per provider. Relative imports and direct test imports must change. Typecheck, focused provider tests, and the backend suite must pass after the move. If the move breaks consumers, restore the old paths and imports; no data migration is involved.
