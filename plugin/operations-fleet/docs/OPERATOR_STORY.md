# Operator story

## One-time onboarding

Alex opens a private operations workspace and says:

```text
Help me set up my operations work.

We use Jira project DATAOPS. Most pipeline and DQ work is in Databricks.
Access requests involve Databricks and Microsoft Entra. Code is in GitHub.
Weekly reports are published to SharePoint and sent through Microsoft Graph.
Our SOPs, runbooks, owners, templates, and operating rules are in knowledge/.
Start with read-only ticket review and RCA. Ask me only for missing details.
```

The setup skill:

1. reads the supplied knowledge and available tools;
2. asks for material missing values such as Jira site, Databricks workspaces, connection method, and approved ticket view;
3. writes one `operations.yaml` file;
4. generates `.mcp.json` for MCP connections;
5. keeps credentials outside the repository;
6. checks harmless reads;
7. returns one safe first prompt.

Alex does not configure the RCA, ticket, document, and communication skills separately.

## Morning review

Alex starts Claude Code in the workspace:

```text
Show my actionable tickets. Group them into access, data quality, pipeline,
and other. Tell me what is ready, blocked, or at SLA risk.
```

The orchestrator uses `tickets`, approved team definitions, and the configured Jira view. It returns a prioritized queue instead of a raw export.

Alex then says:

```text
Investigate DATAOPS-1854. Do not change Jira or Databricks.
```

The orchestrator uses `monitoring` to find the first meaningful failure, `rca` to build and test the causal chain, and `verification` to challenge the conclusion. If current Databricks behavior or an unfamiliar error matters, it uses `research` and cites current official documentation. It then prepares, but does not apply, a ticket update.

## Access request

Alex says:

```text
Handle DATAOPS-1849 and verify the result. Ask before making the access change.
```

The `access` skill resolves the exact person, target, role, effective access, authoritative approval, and policy. It presents the before and intended after state. After approval, it performs one bounded change, reads the state back, and asks `verification` to confirm the exact entitlement without wider privilege.

## Code and recovery

For a demonstrated source defect, the orchestrator uses `build` to create the smallest tested change and pull request. A later approved request can use `remediation` to deploy the exact artifact to dev or perform a bounded recovery. `verification` tests the original failure and likely side effects before the ticket can be described as resolved.

## Weekly report

Alex says:

```text
Create this week's operations workbook and deck from Jira, reconcile all
metrics, review the rendered files, publish the approved versions to the normal
SharePoint location, and prepare the stakeholder email for approval.
```

The `documents` skill creates the source ledger, workbook, story, deck, and review evidence. The exact reviewed files are published. The `communication` skill drafts a concise message using those exact artifacts and verified results. Sending remains behind the configured approval.

## Repeated work

After a manual journey succeeds, Alex says:

```text
Save this as our Friday weekly-report workflow. Publishing and sending must
still require approval.
```

The `workflow` skill records the outcome, trigger, scope, parameters, authority, success, failure behavior, and preserved evidence. It does not hard-code an agent-by-agent chain.
