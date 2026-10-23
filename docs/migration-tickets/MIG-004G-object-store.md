# MIG-004G — Type workspace object stores

- Status: done
- Parent: MIG-004
- Depends on: MIG-004F
- Decision: ADR 0002

## Scope

Convert `backend/src/storage/object-store.mjs` to `.mts`. Type the S3 and Databricks volume implementations and their common list/get/put/delete contract. Preserve key encoding, paging, object metadata, content types, and request behavior.

## Acceptance

- [x] Both implementations satisfy a checked object-store contract, and the compiled `.mjs` path resolves.
- [x] Existing workspace and deployment tests pass without changing stored keys or objects.
- [x] Typecheck, compiled smoke, and required repository suites pass; record external service verification limits.

## Evidence

`npm run verify:build` passed typecheck, build, and 9 compiled checks. The compiled volume check covers relative keys, metadata, and file reads. `npm test` passed 339, failed 0, skipped 6; `npm run quality:check` passed 382 frontend tests and built; plugin validation passed and 56 unit tests passed. The focused deployment test run inside the restricted sandbox passed 3 and failed 4 because its local listener was denied (`listen EPERM`); the full backend run with listener access passed. Live S3 and Databricks services were not available, so their network paths remain unverified externally.
