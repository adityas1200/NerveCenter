# Architecture

## One plugin, one entry point

The user installs one plugin and talks to one orchestrator. Skills are reusable operating modes, not separately installed agents.

```text
User or scheduled request
          |
          v
     Orchestrator
          |
          +-- orchestrate
          +-- research
          +-- tickets
          +-- monitoring
          +-- rca
          +-- access
          +-- build
          +-- remediation
          +-- verification
          +-- documents
          +-- communication
          +-- knowledge
          +-- setup
          +-- workflow
          |
          v
 MCP servers / native tools / CLIs / approved APIs
```

The orchestrator owns the conversation, scope, approvals, exact identifiers, and final answer. Skills provide expert methods. Tools provide live data and controlled actions.

Every request follows a shared entry sequence before specialist execution:

```text
Operator request
      |
      v
Operations Fleet orchestrator
      |
      +-- reads operations.yaml
      +-- discovers relevant approved knowledge from its index
      +-- checks live systems through connected tools
      +-- researches current public guidance when needed
      +-- loads the relevant task skill
      +-- asks for approval before a material write
      +-- reads the result back after a write
      +-- uses independent verification
      |
      v
One clear result, artifact, or approved action
```

Knowledge discovery is mandatory; loading the entire knowledge corpus is not. The orchestrator starts from the configured index, follows only relevant links, and carries the selected concepts and their trust state into the specialist handoff.

## What stays separate

| Concern | Location | Example |
|---|---|---|
| Operating method | Skill | How to investigate a failed pipeline |
| Stable mappings and boundaries | `operations.yaml` | Jira project, Databricks workspace, production policy |
| Team knowledge | Knowledge folder or MCP | SOPs, owners, business definitions, runbooks |
| Credentials | OAuth, managed identity, environment, secret manager | Jira or Microsoft authentication |
| Live truth | Connected provider | Current ticket state or failed run |
| Current public facts | Web research | Current API behavior or vendor limit |
| Work products | Workspace or external artifact store | RCA, PR, workbook, deck, email preview |

This separation keeps skills reusable without hiding client-specific behavior.

## Source priority

Use evidence in this order:

1. explicit user instruction within their authority;
2. enforced policy and provider permissions;
3. current authoritative system state;
4. approved, applicable internal knowledge;
5. current official public documentation;
6. historical examples and unapproved drafts.

A public page can explain how a provider works. It cannot approve an internal action. A runbook can explain a check. It cannot prove the current state.

## Freshness

Use the `research` skill when public information could have changed: product capabilities, API syntax, release behavior, security guidance, regulations, current incidents, or an unfamiliar error. Prefer primary sources, check dates and applicability, and cite the result.

Do not browse merely to repeat stable client facts. Never place private evidence in public search.

## Skill handoffs

For multi-step work, the orchestrator passes the next skill only:

- the bounded goal;
- relevant facts and evidence;
- exact IDs, environments, revisions, time windows, and files;
- allowed actions and approval state;
- the expected result.

The next skill returns its conclusion, evidence, actions or draft, artifacts or record IDs, and gaps — not an opinion on what runs next. The orchestrator chooses the next skill from current evidence; it does not follow a fixed chain — including inside a saved `workflow` that names several skills it may use (for example, RCA leading to a fix, a written record, and a stakeholder update): the workflow declares the set of skills, not their order, and each run re-derives the order from that run's evidence.

When a client wants a recognizable scenario (like an incident) to always follow the same end-to-end path, that path belongs in a knowledge `Playbook` — not in a skill, which would otherwise apply one fixed idea of the flow to every client.

## Writes and verification

Before a material write, establish target, scope, authority, approval, expected effect, and rollback or recovery path. After a write, refresh the authoritative state. Use independent verification before saying that access, deployment, recovery, closure, publication, or communication is complete.

Enforcement belongs primarily in provider permissions, environment protection, allowlists, approval systems, and secret handling. Skills add decision discipline; they are not an access-control system.

## Files and artifacts

A reviewed file should be handed to the next task by exact path or provider ID, media type, state, size, and digest when available. Publication and communication must use the exact reviewed bytes, not a regenerated or stale copy.

## Non-goals

The plugin does not implement:

- a custom workflow engine;
- one agent per provider;
- embedded client credentials;
- a universal Jira, Databricks, or identity adapter;
- a fixed sequence for every ticket;
- duplicate office-file engines when the host already provides them.
