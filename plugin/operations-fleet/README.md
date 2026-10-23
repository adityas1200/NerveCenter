# Operations Fleet

Operations Fleet is one installable Claude Code plugin for day-to-day operations work. It contains one orchestrator and focused skills for:

```text
orchestration, research, tickets, monitoring, RCA, lineage and impact, data questions, data pulls, access,
build, remediation, verification, documents, communication, knowledge,
knowledge extraction from uploaded documents, setup, workflows, and a
final writing pass (unslop)
```

The plugin supplies the operating method. Client systems remain replaceable through MCP servers, native tools, CLIs, or approved APIs.

## Product model

```text
User request
    |
    v
One orchestrator
    |
    +-- reads operations.yaml
    +-- discovers relevant approved knowledge from its index
    +-- checks live systems through connected tools
    +-- researches current public guidance when needed
    +-- loads the relevant skill
    +-- controls writes and reads results back
    +-- uses independent verification
    |
    v
One clear result, artifact, or approved action
```

The plugin does not embed Jira, ServiceNow, Databricks, Snowflake, GitHub, SharePoint, email, or identity credentials.

## Install locally

```bash
claude --plugin-dir ./operations-fleet
```

Skills can be selected automatically or invoked directly:

```text
/operations-fleet:rca
/operations-fleet:documents
/operations-fleet:research
/operations-fleet:setup
```

## Create a client workspace

```bash
python operations-fleet/skills/setup/scripts/init_workspace.py ./client-operations
```

There is one setup file. The user can edit it directly or let the setup skill fill it from plain-language answers:

```text
client-operations/
├── operations.yaml       # the only setup file the user edits
├── CLAUDE.md             # supplied guidance
├── knowledge/            # SOPs, runbooks, definitions, owners, templates
├── workflows/            # repeated outcomes created later
└── templates/            # optional document templates
```

Open the workspace and ask:

```text
Help me complete this setup for Jira ticket review, read-only Databricks RCA,
our team knowledge, and email previews. Ask only for information that is
missing. Do not enable writes yet.
```

The setup skill writes `operations.yaml`, generates `.mcp.json` for MCP connections, checks the local workspace, and gives a safe first test.

See [Client setup](docs/CLIENT_SETUP.md) and the [example workspace](examples/client-workspace/README.md).

## Current information

The orchestrator uses web research when a conclusion depends on changing public facts such as vendor behavior, API syntax, product limits, release changes, security guidance, regulations, or unfamiliar errors. It prefers official sources and cites them.

Public search never receives secrets, private ticket text, internal logs, customer data, or proprietary code. Public guidance cannot override client policy, approved knowledge, provider permissions, or live system state. See [Research and freshness](docs/RESEARCH_AND_FRESHNESS.md).

## Typical requests

```text
Show my actionable Jira tickets. Group them by access, data quality, pipeline,
and other. Investigate the highest-priority failure and prepare the ticket
update. Do not change anything.
```

```text
Handle this ordinary access request. Resolve the exact user, entitlement,
approval, and current effective access. Make only the approved change, read it
back, and verify it.
```

```text
Create this week's operations workbook and deck, reconcile them to Jira,
review the rendered files, publish the approved versions, and prepare the
stakeholder email.
```

## Validate and package

```bash
python -m pip install -r requirements-dev.txt
python tools/validate_plugin.py
python -m unittest discover -s tests
python tools/package_plugin.py ../operations-fleet.zip
```

The repository intentionally contains one plugin, one main agent, one skill per recognizable task, one client configuration file, and no generated demo artifacts or provider-specific framework.
