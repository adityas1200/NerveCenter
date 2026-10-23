# Workflow design

Create a workflow only after the manual journey produces a good result.

A durable workflow needs:

- outcome and business owner;
- trigger and timezone;
- parameters and target scope;
- connection and alias references from `operations.yaml`;
- allowed, approval-controlled, and denied actions;
- observable success and skip conditions;
- retry count, idempotency key or locking strategy, and ambiguous-result handling;
- artifacts and audit evidence to preserve;
- failure notification and manual recovery path;
- service identity and secret location for unattended runs;
- disable or pause procedure.

Do not encode model reasoning as a rigid sequence when the next action depends on evidence. Use a fixed sequence only where an external protocol or deterministic transformation requires it.

A workflow that spans several skills (an RCA that can lead to a fix, a written record, and a stakeholder update) does not name those skills or their order. `uses` lists only the connections it relies on. The orchestrator's current evidence, together with any matching knowledge `Playbook`, decides at run time which skills run, in what order, and whether a step is skipped (for example, no fix needed, or no stakeholder update was promised).
