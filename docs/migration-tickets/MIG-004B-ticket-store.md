# MIG-004B — Type ticket store contracts

- Status: done
- Parent: MIG-004
- Depends on: MIG-002, MIG-003
- Decision: ADR 0002

## Scope

Convert `backend/src/app/operations-store.mjs` to `.mts`. Define the shared ticket, activity, settings, and store method contracts for its file and Postgres implementations. Preserve source-key matching, merge behavior, project checks, SQL, and stored record shapes. Do not change services, migrations, or other stores in this slice.

## Acceptance

- [x] File and Postgres ticket implementations satisfy the same checked interface and emitted `.mjs` imports resolve.
- [x] Existing ticket, project scope, and migration tests pass. Add a focused test only for an uncovered critical path.
- [x] Typecheck, compiled smoke, and all required repository suites pass; record any external Postgres verification limit.

## Evidence — 2026-10-10

- `backend/src/app/operations-store.mts` defines ticket, activity, settings, file-state, query, and store contracts implemented by both file and Postgres classes. The compiled module retains the `.mjs` import path. SQL, source-key matching and merge behavior, record shapes, and the shared project-scope helpers are unchanged.
- `npm run verify:build`: typecheck/build passed; compiled smoke 4 passed, 0 failed, 0 skipped. One focused compiled check covers source identity per connection and project isolation.
- Full suites: backend 339 passed, 0 failed, 6 skipped; frontend 382 passed, 0 failed; plugin validator passed and 56 tests passed, 0 failed. Runtime Postgres ticket checks were unavailable because `NC_TEST_DATABASE_URL` is unset; both implementations compile against the same interface.
