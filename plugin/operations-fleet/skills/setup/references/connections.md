# Connections

A connection tells the host how to reach a system. It does not grant business authority.

When the host manages connections through its own connectors page, it writes these entries and any `.mcp.json` itself. Use its page and `list_connections` / `test_connection`; skip everything below.

Supported template patterns:

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

  internal-service:
    kind: api
    base_url: ${INTERNAL_API_URL}
    auth: oauth

  email:
    kind: smtp
    env:
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
```

`render_mcp.py .` converts `kind: mcp` connections in the workspace to project `.mcp.json`. HTTP, SSE, and stdio are supported by the template. Use environment references for headers and environment variables; do not store secret values.

After generation, in a plain Claude Code workspace:

1. start a new Claude Code session;
2. approve project MCP servers;
3. use `/mcp` to authenticate and inspect status;
4. test a harmless read;
5. compare actual permissions with `policy` in `operations.yaml`.

Official references:

- [Claude Code MCP quickstart](https://code.claude.com/docs/en/mcp-quickstart)
- [Claude Code MCP reference](https://code.claude.com/docs/en/mcp)
