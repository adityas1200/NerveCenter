# MIG-005 — Type domain services

- Status: done
- Depends on: MIG-003, MIG-004
- Decision: ADR 0002

## Scope

Convert service modules by domain, beginning with those that use the typed store and access contracts. Keep route responses, external input validation, and secret handling unchanged. Split by domain before implementation when needed for a reviewable diff.

The slices are [MIG-005A](MIG-005A-provider-services.md) for provider services, [MIG-005B](MIG-005B-connection-services.md) for connections and connectors, [MIG-005C](MIG-005C-grants-quality-services.md) for grants and data quality, [MIG-005D](MIG-005D-content-services.md) for content services, and [MIG-005E](MIG-005E-operations-service.md) for the central operations service.

## Acceptance

- [x] Converted services have checked collaborator, input, and return types without `any` standing in for domain records.
- [x] Existing domain tests and the compiled smoke check pass; only uncovered critical behavior gets a new focused test.
- [x] The shared authorization and secret-store boundaries remain intact.

## Evidence

MIG-005A through MIG-005E are complete. Parent gate: backend 339 passed, 0 failed, 6 skipped (database URL unset); compiled backend smoke 9 passed, 0 failed, 0 skipped; frontend quality check 382 passed, 0 failed and production build passed; plugin validator passed and 56 plugin tests passed, 0 failed. A sandboxed backend attempt crashed native test workers; the successful full run used local socket access.
