# MIG-004 — Type store contracts

- Status: done
- Depends on: MIG-002, MIG-003
- Decision: ADR 0002

## Scope

Convert file and Postgres store boundaries in reviewable slices. Type inputs, persisted records, and return values while preserving runtime validation, migration behavior, and the current record shapes. Split this ticket before coding if the store diff cannot be reviewed as one change.

This ticket is an umbrella for separate store slices. [MIG-004A](MIG-004A-task-inbox-store.md) owns the task and inbox store, [MIG-004B](MIG-004B-ticket-store.md) owns ticket operations, [MIG-004C](MIG-004C-project-store.md) owns project persistence, [MIG-004D](MIG-004D-rbac-store.md) owns RBAC, [MIG-004E](MIG-004E-connection-profile-store.md) owns connection profiles, [MIG-004F](MIG-004F-secret-store.md) owns secrets, and [MIG-004G](MIG-004G-object-store.md) owns workspace object stores.

## Acceptance

- [x] File and Postgres implementations satisfy the same typed contracts without schema or file-record changes.
- [x] Existing store and migration suites plus a focused compiled-path check cover the compiled file path and Postgres stores through existing tests.
- [x] Typecheck and build pass after each slice.

## Evidence

MIG-004A through MIG-004G are done with their recorded checks. The final slice passed typecheck, build, 9 compiled checks, 339 backend tests (0 failed, 6 skipped), 382 frontend tests, plugin validation, and 56 plugin tests. No live Postgres check was available because `NC_TEST_DATABASE_URL` is unset; no live cloud storage check was available.
