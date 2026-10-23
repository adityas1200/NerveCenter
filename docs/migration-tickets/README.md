# Backend migration tickets

This is the execution board for the [TypeScript then Express plan](../backend-typescript-express-migration.md) on `zs-sandbox`. [ADR 0002](../adr/0002-migrate-backend-to-typescript.md) and [ADR 0003](../adr/0003-adopt-express-for-backend-http.md) are accepted. These tickets track implementation; product behavior and stored data remain governed by `specs/` and approved ADRs.

## How to use this board

1. Pick a **ready** ticket whose dependencies are done. Mark it **in progress** before editing code. The first two ready tickets may run in parallel only with separate file ownership.
2. Keep the change within that ticket. Record a discovered dependency or scope change in the ticket before doing more work; split a ticket if its diff stops being reviewable.
3. Use existing focused checks for each behavior-preserving slice and run the full backend, frontend, and plugin suites at parent gates and before handover. Add a focused test only for an uncovered critical path; every new feature requirement still needs its required test.
4. Mark **done** only after its acceptance boxes are checked and its Evidence section records commands, pass/fail/skip counts, and any unverified artifact. A blocker names the next action and owner; do not mark partial work done.
5. Update this table and the ticket file together. Use [TEMPLATE.md](TEMPLATE.md) for additional tickets.

Status values: **ready** (unblocked), **in progress** (being changed), **planned** (dependency pending), **blocked** (cannot proceed; reason recorded), **done** (accepted checks met).

## Board

| Order | Ticket | Status | Depends on |
| --- | --- | --- | --- |
| 1 | [MIG-001 — TypeScript foundation](MIG-001-typescript-foundation.md) | done | — |
| 2 | [MIG-002 — Migration import paths](MIG-002-migration-import-paths.md) | done | MIG-001 |
| 3 | [MIG-003 — Shared HTTP and access types](MIG-003-shared-contracts.md) | done | MIG-001 |
| 4 | [MIG-004 — Store types](MIG-004-store-types.md) | done | MIG-002, MIG-003 |
| 4A | [MIG-004A — Task and inbox store](MIG-004A-task-inbox-store.md) | done | MIG-002, MIG-003 |
| 4B | [MIG-004B — Ticket store](MIG-004B-ticket-store.md) | done | MIG-002, MIG-003 |
| 4C | [MIG-004C — Project persistence](MIG-004C-project-store.md) | done | MIG-004A, MIG-004B |
| 4D | [MIG-004D — RBAC store](MIG-004D-rbac-store.md) | done | MIG-004C |
| 4E | [MIG-004E — Connection profile store](MIG-004E-connection-profile-store.md) | done | MIG-004D |
| 4F | [MIG-004F — Secret store](MIG-004F-secret-store.md) | done | MIG-004E |
| 4G | [MIG-004G — Object store](MIG-004G-object-store.md) | done | MIG-004F |
| 5 | [MIG-005 — Service types](MIG-005-service-types.md) | done | MIG-003, MIG-004 |
| 5A | [MIG-005A — Provider services](MIG-005A-provider-services.md) | done | MIG-004 |
| 5B | [MIG-005B — Connection services](MIG-005B-connection-services.md) | done | MIG-005A |
| 5C | [MIG-005C — Grant and data quality services](MIG-005C-grants-quality-services.md) | done | MIG-005B |
| 5C1 | [MIG-005C1 — Grant service](MIG-005C1-grant-service.md) | done | MIG-005B |
| 5C2 | [MIG-005C2 — Data quality service](MIG-005C2-data-quality-service.md) | done | MIG-005C1 |
| 5D | [MIG-005D — Content services](MIG-005D-content-services.md) | done | MIG-005C |
| 5D1 | [MIG-005D1 — Board service](MIG-005D1-board-service.md) | done | MIG-005C |
| 5D2 | [MIG-005D2 — Knowledge service](MIG-005D2-knowledge-service.md) | done | MIG-005D1 |
| 5D3 | [MIG-005D3 — Skill and template services](MIG-005D3-skill-template-services.md) | done | MIG-005D2 |
| 5E | [MIG-005E — Operations service](MIG-005E-operations-service.md) | done | MIG-005D |
| 6 | [MIG-006 — Task runtime and bootstrap](MIG-006-task-runtime.md) | done | MIG-005 |
| 6A | [MIG-006A — Permission policy](MIG-006A-permission-policy.md) | done | MIG-005 |
| 6B | [MIG-006B — Agent tools](MIG-006B-agent-tools.md) | done | MIG-006A |
| 6C | [MIG-006C — Task runtime](MIG-006C-task-runtime.md) | done | MIG-006B |
| 6D | [MIG-006D — Bootstrap](MIG-006D-bootstrap.md) | done | MIG-006C |
| 7 | [MIG-007 — Deployment parity](MIG-007-deployment-parity.md) | done | MIG-006 |
| 8 | [MIG-008 — Express edge](MIG-008-express-edge.md) | done | MIG-007 |
| 9 | [MIG-009 — Route groups and release](MIG-009-route-groups-release.md) | done | MIG-008 |
| 10 | [MIG-010 — Integrate latest zs-sandbox](MIG-010-upstream-rebase.md) | done | MIG-009 |
| 11 | [MIG-011 — Port generative task UI](MIG-011-generative-ui-port.md) | done | MIG-010, SPEC-tasks-10 |

**Current action:** user testing of the integrated task page and component catalog.
