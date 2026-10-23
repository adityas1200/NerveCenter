# Client setup

A normal user should not configure every skill or learn a configuration schema. They describe their environment in plain language; the setup skill asks only for missing details and maintains one `operations.yaml` source of truth. A technical user may edit that file directly.

## Workspace

```text
client-operations/
├── operations.yaml
├── CLAUDE.md
├── .mcp.json             # generated for MCP connections
├── knowledge/
├── templates/
└── workflows/
```

`operations.yaml` is the only setup file the user edits. Knowledge and workflows are content created through normal use, not additional configuration files.

## Create the workspace

```bash
python /path/to/operations-fleet/skills/setup/scripts/init_workspace.py ./client-operations
cd client-operations
claude --plugin-dir /path/to/operations-fleet
```

Ask:

```text
Set up this workspace for my first journey. We use Jira for tickets,
Databricks for data operations, GitHub for code, SharePoint for reports,
and Microsoft Entra for access. Our knowledge is in the knowledge folder.
Ask only for missing details and keep all writes disabled for the first test.
```

The setup skill asks about only the systems needed by that journey.

## What goes in operations.yaml

| Section | What the user describes |
|---|---|
| `team` | Team, operator, timezone, useful defaults |
| `ticketing` | Platform, project or queue, views, fields, states, conventions |
| `platforms` | Databricks, Snowflake, or other environments and monitoring locations |
| `identity` | Identity provider, common entitlements, approvers, special rules |
| `source_control` | Repository, branch pattern, tests, reviews, deployments |
| `documents` | Templates and publication destinations |
| `communication` | Sender, recipient aliases, channel, tone, restrictions |
| `knowledge` | Local path or MCP connection and approved collections |
| `policy` | Simple write, production, privileged-access, closure, and sending boundaries |
| `connections` | MCP, native, CLI, or API connection descriptions |
| `routines` | Human descriptions of common daily and weekly work |

The canonical template is at `skills/setup/assets/operations.template.yaml`.

## Connections

A connection can be:

```yaml
connections:
  jira:
    kind: mcp
    transport: http
    url: ${JIRA_MCP_URL}

  local-knowledge:
    kind: mcp
    transport: stdio
    command: python
    args: [../knowledge-server/server.py]

  github:
    kind: cli
    command: gh

  microsoft:
    kind: api
    provider: microsoft-graph
    auth: oauth
```

Generate Claude Code project MCP configuration:

```bash
python /path/to/operations-fleet/skills/setup/scripts/render_mcp.py .
```

Start a new Claude Code session, approve the project servers, and use `/mcp` to authenticate and inspect status.

## Credentials

Do not place tokens, passwords, client secrets, certificates, or private keys in `operations.yaml`, knowledge, workflows, prompts, or Git.

Use:

- delegated OAuth for interactive work;
- managed identity or workload identity;
- environment variables injected by the host;
- an approved secret manager;
- narrowly scoped service identities for scheduled work.

## Knowledge

Place or connect:

- ticket SOPs and closure rules;
- system diagrams and ownership;
- data definitions and DQ rules;
- pipeline and recovery runbooks;
- access entitlements and approver rules;
- repository and deployment conventions;
- report templates and communication tone;
- daily and weekly operating routines.

The setup skill inventories what is available and lists material gaps. It does not require the user to rewrite everything into configuration.

## Readiness check

```bash
python /path/to/operations-fleet/skills/setup/scripts/check_workspace.py .
```

Then ask Claude Code:

```text
Check this workspace for morning ticket review and read-only RCA. Use harmless
reads only. Report each system as ready, limited, blocked, or not configured.
```

Enable writes only after the read-only journey works, provider permissions are scoped, error paths are tested, and the user understands the approval boundary.
