# MIG-005C2 — Type data quality service

- Status: done
- Parent: MIG-005C
- Depends on: MIG-005C1
- Decision: ADR 0002

## Scope

Convert `data-quality-service` to `.mts` with checked table configuration, DDL mapping, query rows, monitor results, and ticket routing. A partial typing pass is parked for this ticket; finish it after MIG-005C1.

## Acceptance

- [x] DQ inputs, records, and collaborators are checked without domain-record `any`.
- [x] Existing data quality tests pass with unchanged stored table shape.
- [x] Typecheck, build, and focused data quality checks pass; run full suites at the MIG-005 parent gate.

## Evidence

`npm run verify:build`: typecheck and build passed; compiled smoke 9 passed, 0 failed, 0 skipped. Focused data quality service and API tests: 7 passed, 0 failed, 0 skipped. The earlier restricted run crashed before API assertions; the rerun with listener access passed. Stored table shape and monitor/ticket routing expressions remain unchanged in emitted JavaScript. Full suites are due at the MIG-005 parent gate.
