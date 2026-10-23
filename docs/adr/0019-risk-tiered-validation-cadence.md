# 0019. Risk-tiered validation cadence

- Status: accepted
- Date: 2026-10-13
- Related: AI_CODE_GUIDELINES.md, deploy/ci-test.sh

## Context

AI-assisted changes currently have path-scoped pre-commit checks, but the handoff guidance does not clearly separate an edit-loop check from a feature-level gate. This leads tools to run broad suites repeatedly during small edits. The deployment test entry also runs independent backend and frontend checks sequentially, increasing pipeline time without adding coverage. Backend tests explicitly run serially; their isolation must be proven before that setting changes.

## Decision

Define four validation tiers: focused edit-loop checks, path-scoped pre-commit checks, changed-surface feature handoff checks, and the deploy CI gate. Keep every existing security, approval, and acknowledgement guardrail. Require full checks only for the repository surfaces changed by the feature.

Run the independent backend and frontend jobs in `deploy/ci-test.sh` concurrently, preserving each job's internal order and failing the build when either job fails. Do not change backend test concurrency unless a measured isolation audit and repeated clean parallel runs demonstrate that a higher level is stable.

## Alternatives considered

- Run all suites after every edit: preserves coverage but repeats expensive work without finding a distinct class of failures.
- Remove full handoff checks: lowers latency but loses integration coverage before deployment.
- Increase backend test concurrency immediately: may reduce duration but risks shared-state and timing failures without evidence.

## Consequences

Documentation must publish a path-to-check matrix so agents and reviewers apply the same cadence. CI output must retain backend and frontend logs and report either failure. The serial backend test baseline remains until the audit supplies evidence for a change. Rollback is to restore sequential CI execution; validation coverage and commands remain unchanged.