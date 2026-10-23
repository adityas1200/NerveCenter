---
name: setup
description: Connect your tools and get this ready to use for the first time, producing one simple operations.yaml file. Use for first-time onboarding, adding Jira, ServiceNow, Databricks, Snowflake, identity, source control, SharePoint, email, knowledge, or troubleshooting why the workspace cannot find or use a system.
metadata:
  category: sequential
---

# Set up an operations workspace

The user should describe their environment once. The setup skill writes one non-secret `operations.yaml` file and, only when the host does not manage connections itself, the supporting connection configuration.

## Who owns connections

Check first. When the host manages connections (it has a connectors page, or offers tools such as `list_connections` and `test_connection`), connections are added, tested, and fixed there: do not generate `.mcp.json`, do not edit `connections` by hand, and do not tell people to run `/mcp`. Point them to the host's connectors page and use `list_connections` to report state. Otherwise, in a plain Claude Code workspace, generate the connection file as described below.

## Configure

1. Start with one real journey such as morning ticket review, read-only RCA, weekly reporting, or an ordinary access request.
2. Inspect the workspace, available connections, MCP servers, native tools, CLIs, and existing knowledge before asking questions.
3. Ask only for missing information needed by that journey:
   - team, operator, and timezone;
   - ticket platform, project or queue, useful views, fields, states, and conventions;
   - target platforms and environments;
   - identity systems and common entitlements;
   - repository, branch, test, review, and deployment conventions;
   - document templates, destinations, senders, and recipient groups;
   - knowledge folder or knowledge MCP and its approved collections;
   - connection method for each system (unless the host manages connections);
   - approval and production boundaries.
4. Write `operations.yaml` from `assets/operations.template.yaml`. Fill only systems the user actually uses. Put people, roles, SOPs, and conventions in knowledge, not in configuration.
5. Store no credentials. Use OAuth, managed identity, environment-variable references, or a secret manager.
6. Without host-managed connections, generate `.mcp.json` for configured MCP connections with `scripts/render_mcp.py`. Leave native, CLI, and direct API connections described in `operations.yaml` for the host environment.
7. Inventory the knowledge folder or MCP. Identify missing SOPs, owners, field mappings, templates, and approval rules that will affect the chosen journey.

## Check readiness

1. Run `scripts/check_workspace.py <workspace>` (from this skill's folder) for deterministic local checks.
2. Confirm the plugin skills are visible and each connection answers: `list_connections` or `test_connection` when the host offers them, otherwise the session's MCP status.
3. Use harmless provider health calls or representative reads only.
4. Test one end-to-end read-only request for the chosen journey.
5. Report each system as ready, limited, blocked, or not configured, with the exact reason and next action.

## Finish

Return the completed file, any generated connection file, knowledge gaps, credential steps the user must complete outside the repository, readiness result, and one safe first prompt.

Read [configuration guide](references/configuration-guide.md) and [connection guide](references/connections.md). Use `research` for current provider setup instructions.
