# MIG-005B — Type connection services

- Status: done
- Parent: MIG-005
- Depends on: MIG-005A
- Decision: ADR 0002

## Scope

Convert `connection-service` and `connector-service` to `.mts` using the typed profile and secret stores. Preserve connector configuration, validation, secret references, and permission checks.

## Acceptance

- [x] Collaborators and persisted record types are checked without domain-record `any`.
- [x] Connector and secret tests pass without changed data or access behavior.
- [x] Typecheck, build, and required suites pass.

## Evidence

Converted connection and connector services to `.mts` under ADR 0002. Review restored original missing-value, error-message, secret-reference, and workspace environment expressions. `npm run verify:build` passed typecheck, build, and 9 compiled checks. Focused connector and secret tests passed 16/16. `npm test` passed 339, failed 0, skipped 6; `npm run quality:check` passed 382 frontend tests and built; plugin validation passed and 56 unit tests passed. Live connectors were unavailable; external calls use the existing test stubs.
