# MIG-011 — Port generative task UI

- Status: done
- Depends on: MIG-010, SPEC-tasks-10
- Decision: ADR 0009

## Scope

Bring the feature from `feature/generative-ui-task-page` onto `codex/backend-typescript-express-migration`. Adapt the task runtime and agent tools to the current TypeScript sources, preserve the current task and Inbox pagination, and keep the existing review changes in this working tree. Renumber the feature's component-catalog ADR to 0009 because 0008 already names the provider-adapter decision here.

## Acceptance

- [x] The feature's backend catalog, task-page UI, plugin guidance, specs, and mockup are present, with no stale task-source import paths or conflict markers.
- [x] Existing task and Inbox pagination and authorization behavior remains intact.
- [x] Backend typecheck, compiled build check, backend suite, frontend quality gate, and plugin validation/tests pass; report skips and any inherited failures.
- [x] The working tree is ready for the user's manual testing without committing or pushing the current review changes.

## Evidence

- Source commit: `25769ffb` (`origin/feature/generative-ui-task-page`); shared base: `b4b8b5f4`.
- A recoverable snapshot of the pre-integration working tree is at `/tmp/nervecenter-ui-integration-snapshot` in this workspace.
- Ported the feature's task runtime/tool changes into the current `.mts` sources and preserved task and Inbox server pagination. The original component-catalog ADR became 0009 because this branch already uses 0008 for provider adapters.
- Review found and fixed a private-ticket access gap in the new `show_ticket` component; a same-project private ticket is denied to an unauthorized task creator. The catalog also rejects protocol-relative action links.
- Backend `npm test`: 486 passed, 0 failed, 8 skipped because no database URL was configured. `npm run verify:build`: typecheck/build passed and compiled smoke tests 9 passed, 0 failed, 0 skipped.
- Frontend `BREAKAGE_ALERT_ACK=ack npm run quality:check`: governance, lint, typecheck, 441 tests (0 failed), and production build passed.
- Plugin validator passed; plugin unit suite 56 passed, 0 failed. `git diff --check` passed.
- Changes remain uncommitted for the user's manual testing; this is a content port, so the feature commit is not a Git ancestor of the current branch.
