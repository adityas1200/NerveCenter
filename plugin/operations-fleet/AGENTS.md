# Implementation guidance

Treat this repository as the source of truth for the single Operations Fleet plugin.

Read `README.md`, `docs/ARCHITECTURE.md`, `docs/SKILL_GUIDE.md`, and `docs/RESEARCH_AND_FRESHNESS.md` before changing the design.

Preserve:

- one plugin and one main orchestrator;
- one skill per recognizable operations task;
- one user-edited client configuration file: `operations.yaml`;
- provider connectivity outside the plugin;
- concise main skills with optional references and deterministic scripts;
- current public research without leaking client data.

Do not add package wrappers, duplicate specialist prompts, release metadata, generated demo artifacts, credentials, or a custom orchestration framework without demonstrated need.

Before finishing a change, run:

```bash
python tools/validate_plugin.py
python -m unittest discover -s tests
```
