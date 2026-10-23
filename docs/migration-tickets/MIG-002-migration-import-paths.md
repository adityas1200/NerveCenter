# MIG-002 — Remove migration source-path coupling

- Status: done
- Depends on: MIG-001
- Decision: ADR 0002

## Scope

File migrations imported helpers through `../src`, so production carried a second compiled tree at `src/`. Make migration imports resolve the correct modules in both `tsx` source execution and compiled Node execution, then remove that duplicate tree from deployment artifacts. Keep migration order, state files, and stored record shapes unchanged.

## Acceptance

- [x] Source-mode tests and compiled startup apply file migrations from a fresh temporary store.
- [x] The staged app imports and runs migrations with only one compiled backend tree; both container definitions use the same layout.
- [x] The existing file-migration suite and one compiled runtime smoke check pass; no migration or data-shape change is introduced.

## Evidence — 2026-10-10

- The file-migration runner passes its `exists`, `readJson`, and `writeJson` helpers plus `DATA_DIR` to migrations 003–006. Migration modules no longer import `../src`; their order, markers, and record rewrites are unchanged. The direct migration 006 test now supplies the same context.
- `npm run verify:build`: 2 passed, 0 failed, 0 skipped. The added package check copies `dist/` and `migrations/` into a temporary app with no `src/` tree and applies all migrations.
- `bash deploy/databricks/build.sh` passed. Its 9.0 MB stage has `dist/` and `migrations/`, no `src/`; a separate fresh-store run from that stage applied all 4 file migrations. `Dockerfile` and `deploy/aws/Dockerfile` are identical and both copy only `dist/`.
- Full suites: backend 339 passed, 0 failed, 6 skipped; frontend 382 passed, 0 failed; plugin validator passed and 56 tests passed, 0 failed. A full container image build remains with MIG-007.
