# Example client workspace

`operations.yaml` is the only setup source of truth. A user may edit it, but normally the setup skill asks the missing questions and writes it from plain-language answers.

The workspace also contains:

- `knowledge/` for local SOPs, runbooks, definitions, owners, and templates;
- `workflows/` for repeated outcomes created after a successful manual run;
- `.mcp.json`, generated from MCP connections in `operations.yaml`;
- `CLAUDE.md`, supplied with the workspace and normally left unchanged.

## Start

```bash
python /path/to/operations-fleet/skills/setup/scripts/check_workspace.py .
python /path/to/operations-fleet/skills/setup/scripts/render_mcp.py .
claude --plugin-dir /path/to/operations-fleet
```

Then ask:

```text
Help me complete this operations setup. Ask only for missing information needed
for morning ticket review and read-only RCA. Do not enable writes.
```

Credentials do not go in `operations.yaml`. Complete OAuth sign-in or supply environment variables and managed identities through the approved host environment.
