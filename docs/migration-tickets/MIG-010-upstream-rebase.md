# MIG-010 — Integrate latest zs-sandbox

- Status: done
- Depends on: MIG-009
- Decision: ADR 0002, ADR 0003

## Scope

Rebase the TypeScript and Express migration onto the latest `zs-sandbox`. Carry forward its ticket event, board, data quality, monitoring, project, and audit changes in the compiled backend. Keep file migrations runnable from a package without the source tree.

## Acceptance

- [x] The feature branch is based on the latest `origin/zs-sandbox` and has no unresolved conflicts.
- [x] The converted modules preserve the upstream behavior and pass strict TypeScript checks without file-wide suppression.
- [x] Backend, frontend, plugin, and compiled package checks pass; report external database skips.
- [x] The rebased feature branch is pushed with lease protection.

## Evidence

The rebase brought 38 upstream commits onto the feature branch. The project route table now contains 156 routes, and the scope test checks that exact count. File migrations 007–011 use helpers shipped with the migration package; migration 008 accepts the runner's data directory and direct calls.

- Latest base verified: `b4b8b5f4` (`origin/zs-sandbox`), with a clean ancestor check after a fresh fetch.
- `backend/npm test` against a temporary Postgres instance: 470 passed, 0 failed, 0 skipped.
- `backend/npm run verify:build`: strict typecheck and build passed; 9 compiled smoke tests passed, 0 failed, 0 skipped.
- `frontend/npm run quality:check`: passed; unit suite 419 passed, 0 failed.
- Plugin validator passed; 56 plugin tests passed, 0 failed.
- The full container image could not be built locally because the installed Docker builder lacks buildx; the compiled package smoke includes migrations without a source tree.
