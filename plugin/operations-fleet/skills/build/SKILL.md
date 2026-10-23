---
name: build
description: Implement and test a focused source-controlled fix for a demonstrated operational defect, then prepare or open a pull request. Use when an RCA identifies a defect in code, SQL, a notebook, pipeline, infrastructure as code, configuration as code, or tests.
metadata:
  category: modular
---

# Fix a focused defect

Tie the change to the demonstrated failure mechanism — the specific cause-to-effect chain an RCA already traced, not a new investigation. Do not use an incident as permission for unrelated cleanup.

## Method

1. Confirm the repository, base revision, failing behavior, the causal mechanism (what RCA found actually breaks, step by step), affected scope, acceptance criteria, and allowed actions.
2. Read repository instructions, current working-tree state, relevant code, nearby tests, ownership rules, and recent changes. Preserve unrelated work.
3. Reproduce the failure or create the smallest reliable characterization when direct reproduction is impractical.
4. Plan the smallest change that breaks that chain — the fix should interrupt the specific step RCA identified, nothing more. Avoid unrelated refactors, dependency upgrades, formatting churn, and generated-file noise.
5. Implement in the repository's existing style. Preserve compatibility, security controls, and observability unless the request explicitly changes them.
6. Add or improve a regression test that would catch the old behavior. When practical, demonstrate that it fails before the fix and passes after it.
7. Run focused tests first, then the relevant broader test, static-analysis, build, and validation gates. Record exact commands and outcomes.
8. Review the actual diff for correctness, edge cases, secrets, security, performance, migrations, operational impact, and alignment with the RCA.
9. When authorized, create a focused branch or commit and a pull request on the configured platform. Explain problem, evidence, change, tests, risk, rollout, and rollback. Do not merge or deploy.

## When the host offers change tools

- `show_change` with the diff and how it was tested (unit tests, a dev run, a clone) before asking to apply or push the change, and again with state `applied` once it is in.
- `show_pull_request` after opening or updating a pull request, with the URL, number, title, and branches exactly as the platform returned them. If the host rejects the URL, put the link in `show_change` and the reply instead.

## Source-control platform

Read `source_control.platform` in `operations.yaml` (or the repository's remote) and follow the matching reference: [GitHub](references/github.md) or [Bitbucket](references/bitbucket.md). For another platform, apply the same rules and use `research` for its current API. Take credentials from the environment; never put a token in a remote URL, a file, or a log.

## Write-up outline

```text
Failure reproduced or characterized
Files and behavior changed
Regression coverage
Checks run and results
Diff review and remaining risk
Branch, commit, and pull request
Deployment and verification notes
```

Stop when the causal mechanism is unsupported, the repository or base revision is ambiguous, required tests cannot run, or the change exceeds approved scope. Use `research` for current framework, library, API, or provider behavior.

Read [change quality](references/change-quality.md) and the platform reference when relevant.
