# Clone-first validation

Use this workflow when intending to make a material change to a
table or dataset and an isolated copy — a clone, snapshot, or equivalent — can
represent the affected resource accurately. The copy is the isolation
mechanism; the safety outcome comes from testing on that copy and requiring
separate approval before changing the original.

Do not call this automatic promotion. Changes made to the copy do not update or
sync back to the original. After validation, apply the same reviewed change
separately to the original resource.

## Applicability

Confirm the connected platform's current clone or snapshot behavior — use
`research` for current syntax and limits rather than relying on memorized,
version-sensitive details. Use an isolated copy only when the source format,
catalog, table type, runtime, access mode, source and target locations, and
required privileges support it. Record the exact source version or timestamp
used for the test.

## Platform clones

Use the platform's native zero-copy or shallow clone of a table. Common forms:

```text
Databricks: CREATE TABLE <copy> SHALLOW CLONE <source> [VERSION AS OF <n>]
Snowflake:  CREATE TABLE <copy> CLONE <source> [AT (TIMESTAMP => ...)]
BigQuery:   CREATE TABLE <copy> CLONE <source> [FOR SYSTEM_TIME AS OF ...]
```

For another platform, find its equivalent (a snapshot, branch, or copy-on-write
table) with `research`, and confirm current syntax and limits before relying on
any of these. Run the statements through whatever SQL path the host offers; no
special adapter is needed. Clones cover table resources only.

This workflow does not clone notebooks, jobs, pipelines, clusters, permissions,
secrets, streaming checkpoints, or external side effects. Isolate those with a
source-control branch, development deployment, test job, sandbox, or another
resource-specific mechanism. If the proposed change cannot be represented on a
table clone, stop and select the appropriate isolation method instead.

## When the host offers tested-fix tools

Some hosts run this workflow for SQL tables themselves: a sandbox schema the
agent may write without asking, and tools that copy, test, propose, apply and
verify (for example `create_fix_sandbox`, `run_in_sandbox`, `propose_fix` and
`apply_fix`). When they are offered and a sandbox is set for the platform, use
them instead of raw SQL through a shell or a generic query tool:

1. Copy the table with the copy tool; it records the source version.
2. Change and test only the copy with the sandbox tool. Run the tests you would
   run anyway (bad rows gone, row counts, control totals, uniqueness).
3. Propose the fix with the exact statement for the original, the tests and
   their results, and checks that should hold on the original once fixed
   (a SELECT and its expected value). The host measures the effect itself
   (row counts, differing rows, the checks on the copy, the dashboards that
   read the table, now and after the fix) and shows it to the person.
4. Explain the action, then apply it by the proposal's id. The host refuses if
   the original changed since the test; then copy, test and propose again.
5. Read the host's verification. Report PASS only when it passed; a failed or
   inconclusive verification is not a resolution.

The host's tools enforce the stop conditions below where they can; the rest of
this reference still applies (one bounded change, separate approval, independent
verification, cleanup).

## Required workflow

```text
Inspect original resource
        |
        v
Create isolated provider copy
        |
        v
Apply proposed change to clone
        |
        v
Run technical and data-quality tests
        |
        v
Tests pass?
   No --------> stop and preserve evidence
   Yes
        |
        v
Present exact original-resource change
        |
        v
Obtain separate approval
        |
        v
Apply change to original
        |
        v
Independently verify original
        |
        v
Clean up clone after approval or the retention period
```

### 1. Inspect the original

Use read-only checks to capture:

- fully qualified source identifier, environment, owner, format, table type,
  schema, current version, row count, control totals, constraints, properties,
  grants, dependencies, and active workloads;
- exact intended change and measurable pass criteria;
- current workspace write policy and whether the target is production;
- likely effects that a table clone cannot reproduce.

### 2. Preflight and create the clone

- Generate a unique target in an approved non-production catalog or schema.
- Require the target not to exist. Never use replace or overwrite implicitly.
- Confirm source and target compatibility, privileges, storage and retention
  dependencies, estimated lifetime, cleanup owner, and stop conditions.
- Show the exact clone target and operation before execution when policy
  requires approval. Approval for the intended original change does not imply
  approval for clone creation.
- Execute one clone action and read back the target. If the response is
  ambiguous, inspect the target before retrying.

### 3. Change and test only the clone

- Bind every statement, notebook parameter, job parameter, and test explicitly
  to the clone. Re-read the resolved identifiers before running the change.
- Apply the smallest proposed change to the clone.
- Run the relevant technical, schema, data-quality, row-count, control-total,
  uniqueness, null, and downstream compatibility tests.
- Confirm the original table's version and control totals did not change during
  the test, except for separately observed legitimate source activity.

If any material test fails, stop. Preserve the clone identifier, source version,
change statement or artifact, test results, provider IDs, and timestamps. Do not
modify the original and do not broaden the repair.

### 4. Approve and change the original

After every material clone test passes, present:

- source and clone identifiers and tested source version;
- exact statement, artifact, parameters, and data window proposed for the
  original;
- test evidence, expected effect, blast radius, rollback, and verification plan;
- any drift between the original's current state and the tested source state.

Obtain separate approval for that exact original-resource change. If the source
has drifted in a way that can affect the result, invalidate the test evidence,
refresh the clone, and test again. Execute one bounded change after approval.

### 5. Verify and clean up

Independently verify the original resource, not only the clone:

- expected schema, data window, row counts, control totals, and quality rules;
- original defect or requested behavior;
- duplicates, omissions, downstream freshness, active workloads, and adjacent
  partitions or consumers;
- exact resource version and provider record produced by the change.

Return PASS, FAIL, or INCONCLUSIVE. A passing clone test is not proof that the
original change succeeded.

Retain the clone and evidence until the configured review or rollback window has
ended. Cleanup is another write: confirm the exact clone, verify it is no longer
needed, obtain approval when required, drop only that clone, and read back its
absence. Never delete or vacuum the source as clone cleanup.

## Stop conditions

Stop without modifying the original when:

- write policy or environment authority denies clone creation or promotion;
- the clone type or source and target identifiers are ambiguous;
- the target already exists;
- cloning is unsupported or cannot reproduce the proposed change;
- tests fail, evidence is incomplete, or the source drifts materially;
- rollback or independent verification is undefined;
- any provider response is ambiguous and current state cannot be established.

Use `research` to confirm the connected platform's exact clone or snapshot syntax, limits, and current behavior before relying on it.
