# 0002. Migrate the backend to TypeScript incrementally

- Status: accepted
- Date: 2026-10-10
- Related: specs/platform/http-conventions.md, specs/platform/quality-gates.md, specs/platform/configuration-environment.md, specs/tasks/task-runtime.md

## Context

The backend is Node 22 with ESM `.mjs` modules. It serves the API, runs Sonic sessions, and starts synchronization and routines in one process. The React frontend already uses TypeScript. A second backend runtime would duplicate service, storage, permission, and deployment work. The backend's imports use explicit `.mjs` extensions, and `config.mjs` derives runtime paths from `import.meta.url`; a build can change those paths if this is not handled deliberately.

## Decision

Keep Node and migrate backend source to TypeScript in small, tested slices. Use TypeScript's mixed JavaScript support during the transition. Prefer `.mts` for converted ESM modules so emitted files retain `.mjs` names and imports. Use `tsx` for fast local execution only after verifying mixed-module resolution. Run `tsc` as a separate type-check gate and compile JavaScript for production. Preserve API behavior, stored shapes, process ownership, and agent permissions. Prove the compiled runtime uses the existing data, migration, workspace, plugin, and secret paths before switching startup commands. The implementation sequence is in `docs/backend-typescript-express-migration.md`.

## Alternatives considered

- Convert all files at once: hides type errors among unrelated edits and makes regressions hard to isolate.
- Use `tsx` as the only quality gate: it executes TypeScript without checking types.
- Change the backend runtime: requires a much larger port without helping the immediate type-safety goal.

## Consequences

The project gains checked backend contracts and keeps its Node libraries and deployment model. During migration, `.mjs` and `.mts` coexist. CI and both deployment builds need a TypeScript build and type-check step. Tests must exercise the same production output that is deployed. If the output-path proof fails, keep the existing Node entrypoint while fixing paths; a release can roll back to the previous JavaScript artifact.
