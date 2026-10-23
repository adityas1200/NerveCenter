# MIG-005C1 — Type grant service

- Status: done
- Parent: MIG-005C
- Depends on: MIG-005B
- Decision: ADR 0002

## Scope

Convert `grant-service` to `.mts` with typed project, connection, workspace, and grant collaborators. Preserve overlap and project access decisions and workspace links. Complete the existing partial conversion before moving to data quality.

## Acceptance

- [x] Grant inputs, decisions, and collaborators are checked without domain-record `any`.
- [x] Existing grant and project access tests pass.
- [x] Typecheck, build, and required suites pass.

## Evidence

Converted the grant service to `.mts` under ADR 0002. The constructor still carries its existing audit field, and access, overlap, and workspace link expressions are unchanged. `npm run verify:build` passed typecheck, build, and 9 compiled checks. Focused project grant/access tests passed 38/38. `npm test` passed 339, failed 0, skipped 6; `npm run quality:check` passed 382 frontend tests and built; plugin validation passed and 56 unit tests passed.
