# Roadmap

The source skill set and one-file setup flow are implemented. Production readiness now depends on live evidence, not more plugin architecture.

## 1. Skill quality and routing

- Run direct and natural-language trigger tests in Claude Code.
- Run substantive evals with and without the plugin.
- Rewrite or remove skills that do not create visible improvement.
- Confirm `research` searches current official sources and protects private data.

## 2. Read-only pilot

```text
Assigned ticket queue -> failure review -> RCA -> independent verification -> ticket draft
```

Connect a sandbox Jira or ServiceNow, Databricks or Snowflake, and the knowledge MCP. Test missing data, stale knowledge, permissions, provider errors, prompt injection in tickets, and inconclusive RCA.

## 3. Documents and communication

```text
Ticket data -> workbook -> deck -> content and visual review -> sandbox publish -> email preview
```

Use the host's production document skills. Verify formulas, rendering, source reconciliation, exact artifact handoff, and current external citations.

## 4. One ordinary write

Enable one reversible, non-privileged sandbox access change. Require authoritative approval, read-back, independent verification, and audit evidence.

## 5. Dev recovery

```text
RCA -> focused code fix -> regression test -> PR -> exact dev deployment -> recovery -> verification
```

Test partial writes, duplicate requests, ambiguous provider responses, rollback, and the exact artifact boundary. Keep QA and production disabled.

## 6. Team automation

After manual journeys are stable, add shared case state, service identities, durable scheduling, locking, retries, audit retention, monitoring, support runbooks, and deployment-specific security review.

## Production acceptance

A journey is production-ready only when:

- natural-language routing is reliable;
- output beats the no-skill baseline;
- live provider contract and error-path tests pass;
- private data is not leaked through research;
- every write has bounded scope, authority, read-back, audit, and verification;
- idempotency and concurrency are handled;
- operators can understand, stop, and recover the workflow;
- security, privacy, retention, and client change-management reviews are complete.
