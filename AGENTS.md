# NerveCenter - Agent guide

**Read `AI_CODE_GUIDELINES.md` before any change.** It is the one guardrails file for every AI tool (branches, hard rules, backend, frontend, tests, security, PRs). This file is a quick reference only; if they disagree, `AI_CODE_GUIDELINES.md` wins.

NerveCenter is an operations console for data teams, with an AI agent (Sonic) that investigates and fixes problems. Backend: Node 22, Express 5 over the route table, `.mjs` migrating to TypeScript `.mts`, Claude Agent SDK. Frontend: React + Vite + TypeScript. Deployed on AWS; local development uses files.

## Repo map
- `backend/` API, agent runtime, stores. Read `backend/README.md`.
- `frontend/` UI. Read `frontend/AGENTS.md` and `frontend/STYLE_GUIDE.md` before any UI change.
- `plugin/` vendored `operations-fleet` plugin. Rules in `plugin/SOURCE.md`.
- `specs/` feature specs (the contract). Workflow in `specs/README.md`.
- `docs/` design, plans, `docs/adr/` technical decisions.
- `deploy/` AWS and Databricks deploy scripts and CI test entry (`deploy/ci-test.sh`).

## Run the checks
- Backend: `cd backend && npm test`.
- Frontend: `cd frontend && npm run quality:check`.
- Plugin, after any change: `python plugin/operations-fleet/tools/validate_plugin.py` and `python -m unittest discover -s plugin/operations-fleet/tests`.
- Use the four-tier validation cadence in `AI_CODE_GUIDELINES.md`: focused checks while editing, the path-scoped hook at commit, and full suites only for the surfaces changed before handing over. Report real pass and fail counts, including failures that predate your change.
