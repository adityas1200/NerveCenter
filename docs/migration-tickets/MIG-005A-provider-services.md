# MIG-005A — Type provider services

- Status: done
- Parent: MIG-005
- Depends on: MIG-004
- Decision: ADR 0002

## Scope

Convert the Databricks, Snowflake, Jira, and ServiceNow service modules to `.mts`. Type their external response and request boundaries without changing authentication, URLs, retries, or response mapping. Preserve emitted `.mjs` imports.

## Acceptance

- [x] Provider collaborators, inputs, and outputs have checked types without domain-record `any`.
- [x] Existing provider tests and compiled imports pass without request or response changes.
- [x] Typecheck, build, and required suites pass; record any live-provider verification limit.

## Evidence

Converted four provider services to `.mts` under ADR 0002. Review kept Snowflake bind fallback and Jira user lookup behavior unchanged. `npm run verify:build` passed typecheck, build, and 9 compiled checks. Focused Databricks and Jira tests passed 26/26 with listener access. `npm test` passed 339, failed 0, skipped 6; `npm run quality:check` passed 382 frontend tests and built; plugin validation passed and 56 unit tests passed. Live provider credentials were unavailable, so external API behavior was verified through existing stubs and contracts.
