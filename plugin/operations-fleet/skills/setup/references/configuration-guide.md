# One-file configuration guide

`operations.yaml` is the only setup file a user should edit. Other files are generated or created through normal use.

Use its sections for:

- `team` - team, operator, timezone, and defaults;
- `ticketing` - platform, connection, scope, views, fields, states, and conventions;
- `platforms` - Databricks, Snowflake, or other operational environments;
- `identity` - identity provider and common entitlements;
- `source_control` - repository and change conventions;
- `documents` - templates and publication destinations;
- `communication` - sender, recipient aliases, internal domains, channels, and tone notes;
- `branding` - optional name, accent colour, font, logo, and footer for reports and email;
- `knowledge` - local path or MCP connection and approved collections;
- `policy` - simple authority boundaries per category (`email_send`, `privileged_access`, `production_changes`, `ticket_writes`, `workspace_changes`, `knowledge_drafts`, `default_write`), each `allow`, `ask`, or `deny`;
- `connections` - how the host reaches each external system;
- `routines` - human descriptions of common daily or weekly outcomes.

A host may add its own sections (for example `sync`, `connectors`, `ui`, `agent`, or policy `rules`); leave them as the host wrote them.

Fill only what the team uses. Put detailed SOPs, runbooks, field definitions, escalation paths, and templates in the knowledge folder or knowledge MCP.

Use `assets/operations.template.yaml` as the canonical template.
