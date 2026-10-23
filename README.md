# NerveCenter

NerveCenter is an operations console for data teams. Its React UI talks to a Node.js API that manages tickets, monitoring, tasks, routines, and sessions with the vendored `operations-fleet` agent plugin. The same application runs locally and on AWS or Databricks.

## Local development

Use Node.js 22. Start the backend and frontend in separate terminals from the repository root.

Backend:

```bash
cd backend
npm install
npm run dev
```

The API listens on `http://127.0.0.1:8787`. Local development uses file storage under `backend/data/` and the agent workspace at `backend/workspace/`. Running real agent tasks requires an `ANTHROPIC_API_KEY`; the app can be run and tested without one. Connector credentials are held in memory by default locally. To retain them across restarts, configure `OPS_SECRET_STORE=file` before starting the backend. No credentials are set up automatically.
Run one backend instance per workspace so the process handling a task also receives its approvals.

Frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite serves the UI at `http://localhost:5175` and proxies `/api` to the local backend. For the integrated local setup, leave `VITE_API_BASE_URL` unset. The local backend uses development identity; do not use development identity headers as production authentication.

## Checks

```bash
npm --prefix backend test
npm --prefix frontend run quality:check
bash deploy/ci-test.sh
```

The backend and frontend tests do not require external provider services. Real integration behavior requires configured connectors. For plugin changes, also run:

```bash
python plugin/operations-fleet/tools/validate_plugin.py
python -m unittest discover -s plugin/operations-fleet/tests
```

Install the repository pre-commit hook once per clone:

```bash
git config --local core.hooksPath .githooks
```

The hook runs guardrails and focused checks for staged paths. Full suites remain part of hand-off and CI checks.

## Architecture and contributor guidance

- [Backend guide](backend/README.md): API, agent task lifecycle, storage, and synchronization.
- [Frontend guide](frontend/README.md), [frontend agent guide](frontend/AGENTS.md), and [style guide](frontend/STYLE_GUIDE.md): UI structure and contributor rules.
- [Specs workflow](specs/README.md) and [spec index](specs/INDEX.md): behavioral contracts. Specs are the source of truth for implemented behavior.
- [Design](docs/DESIGN.md): product direction and design context; implementation details can differ from this document.
- [Deployment guide](deploy/README.md): AWS and Databricks deployment layout.
- [Plugin source](plugin/SOURCE.md): provenance of the vendored `operations-fleet` plugin.
- [AI code guidelines](AI_CODE_GUIDELINES.md): repository-wide rules for code changes and verification.

## Deployment

The root [deployment guide](deploy/README.md) describes the AWS and Databricks targets. Both use the shared application in `backend/`, `frontend/`, and `plugin/`; deployment configuration and scripts live under `deploy/`.
