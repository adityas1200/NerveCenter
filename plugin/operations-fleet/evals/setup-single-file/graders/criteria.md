---
type: llm
---
PASS if the answer centers one operations.yaml file, asks only journey-relevant questions, keeps SOPs in knowledge and secrets outside the repository, generates .mcp.json rather than making the user maintain it, leaves business writes disabled, identifies credential steps separately, and gives one harmless end-to-end readiness test.
FAIL if it proposes many user-edited config files, exposes a tickets.read/write capabilities matrix, asks for passwords in YAML or chat, enables writes by default, or gives only generic setup advice.
