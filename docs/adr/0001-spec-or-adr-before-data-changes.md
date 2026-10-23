# 0001. Spec or ADR before data changes

- Status: accepted
- Date: 2026-10-04
- Related: specs/README.md, AGENTS.md, AI_CODE_GUIDELINES.md

## Context
- On 2026-10-03 we reverse-engineered the specs in `specs/` from the code. They found real gaps (see `specs/BACKLOG.md`), because behaviour had been decided inside code reviews and never written down.
- Tables are created inline by the stores (`ensureControlSchema` in `backend/src/storage/postgres.mjs`) while `backend/migrations/` holds almost nothing. Schema is therefore defined in several places and file-store record shapes are implicit.
- The projects feature is about to change the data model. AI agents now write much of the code, and they will follow whatever pattern is nearest.

## Decision
- Any change in behaviour, and any change to data storage (tables, columns, indexes, constraints, migrations, file-store record shapes, the `operations.yaml` schema, secret ref layout), first adds or updates a spec (behaviour) or an ADR (technical decision) with status draft.
- A human approves it before implementation starts.
- The implementing change cites the spec FR ids or ADR number and moves the spec to `implemented`.
- Schema changes go through `backend/migrations/` and cover both the file and Postgres stores. New inline `CREATE TABLE` in stores is not allowed.
- This is written into `AGENTS.md` so every agent and contributor sees it.

## Alternatives considered
- Rely on code review only: this is how the specs went missing.
- Spec for every change, however small: too heavy. Bug fixes that do not change behaviour or storage need no new spec.

## Consequences
- Slower start for data-model work; fewer surprises at review and fewer undocumented tables.
- Existing inline tables stay until a spec/ADR plans their move into migrations.
- Reviewers can reject a change that touches storage without a linked, approved spec or ADR.
