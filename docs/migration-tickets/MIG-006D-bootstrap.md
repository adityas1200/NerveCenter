# MIG-006D — Type bootstrap and entrypoint

- Status: done
- Parent: MIG-006
- Depends on: MIG-006C
- Decision: ADR 0002

## Scope

Convert `bootstrap` and `main` to `.mts`. Type startup collaborators and shutdown while preserving one scheduler, one poller, and one task runtime per backend process.

## Acceptance

- [x] Compiled startup, health, background ownership, and shutdown paths pass.
- [x] Source and compiled task checks pass.
- [x] Typecheck, build, and focused startup checks pass; run full suites at the MIG-006 parent gate.

## Evidence

`cd backend && npm run typecheck -- --pretty false` passed. Focused startup/API check `node --import tsx --import ./tests/test-environment.mjs --test --test-concurrency=1 tests/api.test.mjs tests/workspace-sync.test.mjs tests/project-api-key.test.mjs tests/rbac-routes.test.mjs` passed: 21 tests, 0 failed, 0 skipped. `npm run verify:build` passed typecheck/build and compiled startup smoke checks: 9 tests, 0 failed, 0 skipped. The emitted `main.mjs` retains the dynamic bootstrap import and startup order, and the bootstrap still creates one runtime, ticket poller, integration sync, and routines scheduler per process. Constructor-boundary assertions target the declared `ConstructorParameters` contracts; they bridge existing service signature disagreements around nullability and collaborator return shapes without changing emitted code. The `dev` script now watches `src/main.mts`. Full backend, frontend, and plugin suites remain at the MIG-006 parent gate.
