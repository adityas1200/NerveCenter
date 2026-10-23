# MIG-005C — Type grant and data quality services

- Status: done
- Parent: MIG-005
- Depends on: MIG-005B
- Decision: ADR 0002

## Scope

Convert `grant-service` and `data-quality-service` to `.mts`. Preserve project access decisions, analysis, and result mapping.

The initial combined conversion exposed separate type boundaries. Finish [MIG-005C1](MIG-005C1-grant-service.md) for grants, then [MIG-005C2](MIG-005C2-data-quality-service.md) for data quality.

## Acceptance

- [x] Collaborators, inputs, and outputs have checked types.
- [x] Project access and data quality tests pass.
- [x] Typecheck, build, and required suites pass.

## Evidence

MIG-005C1: focused project grant/access checks 38 passed; full backend 339 passed, 0 failed, 6 skipped; frontend 382 passed with quality/build; plugin validator passed and 56 tests passed. MIG-005C2: typecheck/build and compiled smoke 9 passed; focused data quality service/API checks 7 passed, 0 failed, 0 skipped. The MIG-005 parent runs the full suites again after the remaining services.
