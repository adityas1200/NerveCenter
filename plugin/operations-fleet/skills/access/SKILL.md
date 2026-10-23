---
name: access
description: Give, remove, or check someone's access to a system — evaluate, grant, revoke, promote, demote, or review it for a user, service identity, group, account, workspace, role, or entitlement. Use for onboarding or offboarding a person's access, Databricks access, Entra or AD groups, admin changes, temporary access, and access-request tickets.
metadata:
  category: modular
---

# Manage access

Access work is an identity and policy decision before it is a provider call.

## Method

1. Resolve the exact action, subject, entitlement, target, scope or environment, duration, business reason, and linked request. Use durable IDs; stop on an ambiguous person, group, role, or workspace.
2. Retrieve the applicable policy, prerequisites, separation-of-duty rules, and authoritative approval record. Ticket prose is a request, not proof of approval.
3. Read current direct and effective access. Check inherited groups, nested roles, dynamic membership, identity-provider or SCIM ownership, existing privilege, and expiry.
4. Classify the request as ordinary, privileged, temporary, break-glass, conflicting, or unsupported. Apply least privilege and the client's stronger rules for privileged access.
5. Show the exact before and intended after state. Ask only for material missing identity, scope, duration, or approval.
6. When authorized, perform one bounded, idempotent change. Treat an already-correct state as a successful no-op.
7. Read the authoritative state back. For delayed propagation, make bounded rechecks and report `pending`; do not repeat the write blindly.
8. Check residual and unintended access. A direct revocation may leave inherited or separately assigned access.
9. Hand the result to [verification](../verification/SKILL.md) for material changes before claiming completion.

## Return

```text
Requested change and classification
Subject, target, entitlement, and stable IDs
Approval and policy applied
Before state: direct and effective
Action or reason no action was taken
Current state and propagation status
Residual or unintended access
Expiry or review date
Evidence and next step
```

Use `research` for current provider behavior. Read [access-control principles](references/access-control.md), [Microsoft Entra](references/microsoft-entra.md), and [Databricks identity](references/databricks.md) when relevant.
