# MIG-004F — Type secret store contracts

- Status: done
- Parent: MIG-004
- Depends on: MIG-004E
- Decision: ADR 0002

## Scope

Convert `backend/src/secrets/secret-store.mjs` to `.mts`. Type the memory, file, Postgres, and Secrets Manager implementations behind one contract. Preserve secret reference rules, encryption format, database records, errors, and the existing external secret lookup behavior. Do not log or expose secret values.

## Acceptance

- [x] All four implementations satisfy a checked secret-store contract, and the compiled `.mjs` path resolves.
- [x] Existing secret, connector, and migration tests pass without a change to stored values or access behavior.
- [x] Typecheck, compiled smoke, and required repository suites pass; record any external-store verification limit.

## Evidence

Converted `secret-store.mjs` to `.mts` under ADR 0002 with a shared contract for memory, file, Postgres, and Secrets Manager implementations. The source retains private methods, secret refs, encryption format, file records, SQL, SDK calls, and errors. The compiled smoke covers a file-backed secret across restart; the existing source tests cover encrypted Postgres storage and external `aws:` lookup using stubs.

- `cd backend && npm run verify:build`: typecheck and build passed; compiled smoke 8 passed, 0 failed, 0 skipped.
- `cd backend && npm test`: 339 passed, 0 failed, 6 skipped.
- `cd frontend && npm run quality:check`: governance, lint, typecheck, build passed; 382 unit tests passed, 0 failed.
- Plugin validator passed; plugin unittest suite 56 passed, 0 failed.
- Live Postgres and Secrets Manager calls were not available locally. The six backend skips require `NC_TEST_DATABASE_URL`.
