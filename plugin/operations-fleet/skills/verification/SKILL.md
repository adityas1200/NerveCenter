---
name: verification
description: Independently check whether an RCA conclusion, access change, code fix, deployment, data correction, ticket state, document, communication, or operational recovery is actually correct. Use for is it fixed, was this done, check the RCA, review the result, and before claiming a material outcome is complete.
metadata:
  category: modular
---

# Verify a claim or outcome

Start from a precise claim and observable criteria, not from the acting tool's confidence.

When the host offers `record_finding`, record the result with kind `verification` (or `inconclusive`), the claim and result in the text, and the evidence references (run, query, ticket, file). When it offers `query_data`, use it for the read-only data checks in step 5.

## Method

1. State the claim and exact target: environment, asset, identity, data window, code revision, artifact, ticket, message, or external record.
2. Define pass criteria before inspecting the acting result. Include the original failure condition, desired final state, and important side effects.
3. Gather fresh evidence from authoritative sources. Prefer evidence independent of the original action response when available.
4. Confirm the exact target and version. A healthy different run, environment, user, partition, or file proves nothing about this one.
5. Test the original symptom and the desired outcome. For a data pipeline, a SUCCESS status is not the outcome: check the produced data read-only (freshness, layer counts, and expected markers for the affected window), as in the monitoring skill's data-level checks.
6. Check likely regressions and residual effects: downstream freshness, duplicate data, residual access, wrong recipients, stale attachments, or adjacent failures.
7. Compare each criterion with evidence and return exactly one result:
   - **PASS** - every material criterion is met;
   - **FAIL** - at least one material criterion is contradicted;
   - **INCONCLUSIVE** - required evidence is unavailable, delayed, stale, or too weak.
8. Give the smallest next action for a fail or inconclusive result.

## Result

Lead the reply with the one result word and the claim. The rest is the write-up outline:

```text
Claim tested
Result: PASS | FAIL | INCONCLUSIVE
Criteria and evidence
Original-failure check
Desired-state check
Regression or side-effect check
Contradictions and gaps
Evidence timestamp and scope
Next action
```

Do not remediate inside verification. Do not turn missing evidence into a pass. Use `research` when a verification criterion depends on current public standards or provider semantics.

Read [verification patterns](references/patterns.md) and [evidence quality](references/evidence-quality.md).
