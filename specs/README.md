# Specs

Specs are the source of truth for what NerveCenter does. Code and tests follow them.

## Workflow (spec-driven)
1. **Propose**: new feature or behaviour change starts as a spec edit/new spec (`status: draft`) in a PR.
2. **Review**: approve the spec before code. Discuss behaviour here, not in code review.
3. **Implement**: code and tests reference requirement IDs (`FR-n`). The PR moves the spec to `implemented` and updates `last_verified`.
4. **Verify**: every `FR` has a scenario and a test, or is listed under "Known gaps".

Bug fixes that change behaviour update the spec in the same PR. `docs/DESIGN.md` remains the product vision; specs are the contract.

Technical decisions (storage layout, migrations, library or service choices) go in `docs/adr/` instead; see `AGENTS.md` for the spec-or-ADR-first rule, which also covers any data-storage change.

## Layout
- `specs/<area>/<feature>.md` one spec per feature, using `_templates/feature-spec.md`
- `specs/INDEX.md` list of all specs and status

Specs under this directory that say `status: implemented` were reverse-engineered from the code on 2026-10-03; treat "Known gaps" sections as the first backlog.
