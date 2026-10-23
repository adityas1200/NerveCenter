# MIG-005D — Type content services

- Status: done
- Parent: MIG-005
- Depends on: MIG-005C
- Decision: ADR 0002

## Scope

Convert board, knowledge, skill, and document template services to `.mts`. Preserve file paths, workspace writes, and published content shape.

Reviewable slices: [MIG-005D1](MIG-005D1-board-service.md) for boards, [MIG-005D2](MIG-005D2-knowledge-service.md) for knowledge, and [MIG-005D3](MIG-005D3-skill-template-services.md) for skills and templates.

## Acceptance

- [x] Collaborators, inputs, and outputs have checked types.
- [x] Existing board, knowledge, skill, and document tests pass.
- [x] Typecheck, build, and required suites pass.

## Evidence

Each slice passed typecheck/build and compiled smoke (9 passed, 0 failed, 0 skipped). Focused checks: MIG-005D1 board 13 passed; MIG-005D2 knowledge 29 passed; MIG-005D3 skill/template/workspace 31 passed; no focused failures or skips. Full suites are due at the MIG-005 parent gate.
