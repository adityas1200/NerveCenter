# Architecture Decision Records

An ADR records one technical decision: what we chose, what we rejected, and why. It is short and it does not change after acceptance (write a new one that supersedes it).

## Spec or ADR
- **Spec** (`specs/`): what the product does. Behaviour a user or API client can see. Written with `FR-n` requirements.
- **ADR** (`docs/adr/`): how we build it. Storage layout, migration mechanism, library or service choice, auth model, deployment shape.
- A change that has both (a new feature that adds a table) gets a spec for the behaviour and an ADR only if the technical choice is non-obvious or hard to reverse.
- Data storage changes always need one of the two before code. See ADR 0001.

## Numbering and files
- `NNNN-short-title.md`, four digits, next free number, never reused. Copy `0000-template.md`.
- One decision per ADR. Link related specs and ADRs.

## Statuses
- `proposed`: written, waiting for human approval. No implementation yet.
- `accepted`: approved. Implementation may start or has landed.
- `superseded`: replaced by a later ADR; say which one at the top. Keep the file.

An agent may write a `proposed` ADR. Only a human moves it to `accepted`.
