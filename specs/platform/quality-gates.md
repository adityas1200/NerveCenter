---
id: SPEC-platform-08
title: Quality gates and delivery guardrails
status: implemented
area: platform
owners: []
code:
  - frontend/AGENTS.md
  - frontend/package.json
  - frontend/.husky/pre-commit
  - .githooks/pre-commit
  - frontend/scripts/ai-guardrails-check.mjs
  - frontend/scripts/docs-update-check.mts
  - frontend/scripts/breakage-alert-check.mts
  - frontend/vite.config.ts
  - backend/package.json
  - buildspec.yml
  - buildspec.v2.yml
last_verified: 2026-10-11
---

# Quality gates and delivery guardrails

## Purpose
Keep AI-assisted and human changes safe: block commits on protected branches, make edits to existing tests an explicit human decision, require a docs touch for frontend changes, flag high-risk file edits, and run lint, types, tests and build before hand-over and deploy.

## Scope
- In scope: frontend `npm` quality scripts, the Husky pre-commit hook, the three guard scripts, test runners, CodeBuild deploy specs.
- Out of scope: ESLint rule content, style guide, CI outside this repo.

## Actors and permissions
Developers and coding agents. Overrides are environment variables set by a human.

## Requirements
- **FR-1** `npm run quality:check` (frontend) SHALL run in order: `governance:check` (docs + breakage), `lint:strict` (`eslint . --max-warnings=0`), `typecheck` (`tsc --noEmit` for app and node configs), `test:unit` (`vitest run`), `build` (`vite build`); the first failure SHALL stop the chain.
- **FR-2** `ai-guardrails-check` SHALL fail when the current branch is `zs-sandbox`, `zs-dev`, `release`, `main` or `master`.
- **FR-3** `ai-guardrails-check` SHALL fail when a staged change modifies, renames or deletes (status other than `A`) a file that exists in `HEAD` and matches `__tests__/`, `test/`, `tests/` or `*.test|spec.(js|jsx|ts|tsx|mts)`, unless `AI_TEST_CHANGE_ACK=ack`; it SHALL list the offending paths.
- **FR-4** `docs-update-check` SHALL check repo-relative `frontend/src/`, `frontend/scripts/`, `frontend/.husky/` and frontend config paths, and require a staged `frontend/README.md` or `frontend/STYLE_GUIDE.md` update. Scope is the staged set with `--staged`, else `GOVERNANCE_BASE_REF...GOVERNANCE_HEAD_REF` if both set, else `git diff HEAD`.
- **FR-5** `breakage-alert-check` SHALL match repo-relative frontend config, library, and script paths and require `BREAKAGE_ALERT_ACK=ack` for those changes; it SHALL accept `--staged` in the hook.
- **FR-6** A root pre-commit hook SHALL run the branch/test guardrail and staged docs check for every commit, then run backend typecheck for staged backend source, frontend lint/typecheck for staged frontend source, and the plugin validator for staged plugin changes. It SHALL run focused tests for staged test files and critical backend API, authorization, storage, and frontend API or task paths. Full suites remain required before handover and in CI. The hook SHALL have one documented installation command and work from any repository subdirectory.
- **FR-7** Agent rules in `frontend/AGENTS.md` SHALL hold: run `quality:check` before hand-over; do not bypass the hook without a human; all fetches live in `src/api/` and server state in TanStack Query; shared controls come from `src/components/ui` (shadcn/Radix) and no second UI kit; agent chat has one engine (Task); colours come from tokens, not hex or `bg-white`.
- **FR-8** Unit tests SHALL run with Vitest in jsdom (`src/**/*.{test,spec}.{ts,tsx}`, 20 s timeout, setup `src/test/setup.ts`); backend tests SHALL run `node --test` serially (`--test-concurrency=1`) with `tests/test-environment.mjs` isolating data, forcing development identity, file store and memory secrets.
- **FR-9** `deploy/ci-test.sh` SHALL run backend build verification and tests, plus frontend lint, typecheck, and unit tests before deployment. The deploy buildspec invokes it. Earlier buildspec files retained for compatibility are outside the active test gate.

## Scenarios
### S1 Commit on main
- **Given** branch `main`
- **When** the hook runs
- **Then** "Protected branch ... Create a feature branch" and exit 1.

### S2 Editing an existing test
- **Given** a staged edit to `SettingsPage.test.tsx`
- **When** `AI_TEST_CHANGE_ACK` is unset
- **Then** the commit is blocked listing the file; with `ack` it passes. A newly added test does not trigger it.

### S3 Config change without docs
- **Given** only `package.json` changed
- **Then** the docs check fails asking for `README.md` or `STYLE_GUIDE.md`.

## Interfaces
- Commands: `npm run quality:check | guardrails:check | governance:docs | governance:breakage | lint | typecheck | test:unit | test:coverage | build`; backend `npm test`.
- Env: `AI_TEST_CHANGE_ACK`, `BREAKAGE_ALERT_ACK`, `GOVERNANCE_BASE_REF`, `GOVERNANCE_HEAD_REF`.
- CodeBuild env: `COMPONENT`, `ENVIRONMENT`, `BUCKET_NAME`, `TARGET_INSTANCE_ID`, `TARGET_PATH`, `HEALTH_URL`, `BRANCH_NAME`, `DEPLOYMENT_PROFILE`, `PUBLIC_BASE_PATH`.

## Non-functional constraints
Scripts need Node with `--experimental-strip-types` for `.mts`. The hook requires git on PATH.

## Known gaps / deviations
- The checkout needs the documented hook installation command once; Git hook configuration is local to each clone.
- `breakage-alert-check` is not in the pre-commit hook (only in `quality:check`); `src/types/`, `src/data/`, `src/store/` do not exist in this repo.
- The guardrails and docs scripts have no tests; protected-branch list is hard-coded.
- `README.md` documents `npm run test:e2e` but `package.json` has no such script.
- The active CI entry runs backend and frontend checks; it does not run the frontend production build because deployment builds it separately.
- `vite.config.ts` defines coverage but no thresholds.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1 | `frontend/package.json:7-24` | none |
| FR-2 | `frontend/scripts/ai-guardrails-check.mjs:4,56-60` | none |
| FR-3 | `frontend/scripts/ai-guardrails-check.mjs:5,23-52,62-72` | none |
| FR-4 | `frontend/scripts/docs-update-check.mts` | temporary-repository staged-path probe |
| FR-5 | `frontend/scripts/breakage-alert-check.mts` | temporary-repository staged-path and ACK probe |
| FR-6 | `.githooks/pre-commit`, `AI_CODE_GUIDELINES.md` | shell syntax and temporary-repository focused-path probe |
| FR-7 | `frontend/AGENTS.md` | none (partly lint) |
| FR-8 | `frontend/vite.config.ts:48-61`, `backend/package.json` scripts.test, `backend/tests/test-environment.mjs` | the suites themselves |
| FR-9 | `buildspec.yml:1-95`, `buildspec.v2.yml:1-40` | none |

## Open questions
- The root hook is the single entry point; `frontend/.husky/pre-commit` is replaced by the root hook.
