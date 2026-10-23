# NerveCenter - Copilot instructions

Read and follow `AI_CODE_GUIDELINES.md` at the repo root before suggesting or changing code. It is the canonical guardrails file; the summary below does not replace it.

- Work on a feature branch from `zs-sandbox`; never commit on `zs-sandbox`, `zs-dev`, `release`, `main` or `master`.
- Behaviour or data-storage changes need an approved spec (`specs/`) or ADR (`docs/adr/`) first.
- Schema changes only through `backend/migrations/`; forward-only, safe to run twice, file and Postgres stores both handled.
- Deny by default: every route declares its permission; secrets only through the secret store, never in logs, errors, URLs or tracked files.
- Every query is bounded; no new fallbacks, silent retries or swallowed errors.
- Backend is Node 22 `.mjs` with no framework. Frontend uses `src/components/ui/`, colour tokens, TanStack Query and `src/api/` for every fetch.
- Every change gets a test; never weaken, skip or rewrite an existing test without a human (`AI_TEST_CHANGE_ACK=ack`).
- Stay in scope; no new dependency without a stated reason.
