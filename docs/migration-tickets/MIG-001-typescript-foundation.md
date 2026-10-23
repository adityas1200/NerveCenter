# MIG-001 — TypeScript foundation

- Status: done
- Depends on: none
- Decision: ADR 0002

## Scope

Add mixed-source TypeScript tooling, convert the first leaf modules, compile the backend for production, and wire CI and deployment staging. Preserve HTTP, storage, and task behavior.

## Acceptance

- [x] `tsx` runs source tests and is configured for development; `tsc` checks and emits `.mjs` files from converted `.mts` modules.
- [x] Production starts compiled `dist/main.mjs`; CI checks the build and compiled runtime root, file migrations, and HTTP health.
- [x] Both container definitions and the staged app package compiled output and the migration compatibility path.
- [x] Existing full suites pass without weakening tests.

## Evidence — 2026-10-10

- Converted `src/platform/pipeline-filter` and `src/lib/endpoint` to typed modules. `npm run verify:build`: 1 passed, 0 failed, 0 skipped.
- Backend `npm test`: 339 passed, 0 failed, 6 skipped. Frontend `npm run quality:check`: 382 passed, 0 failed. Plugin validator passed; plugin tests: 56 passed, 0 failed.
- Staged app installed production dependencies, applied file migrations, and answered `/health` locally. A full container image build was unavailable locally; MIG-007 owns that verification.
