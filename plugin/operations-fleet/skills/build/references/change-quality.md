# Operational change quality

A production fix should be easy to review, test, deploy, observe, and reverse.

Check the change for:

- direct connection to the demonstrated causal mechanism;
- a regression test that exercises that mechanism;
- backward compatibility and rollout order;
- schema, data, state, and migration consequences;
- retry, idempotency, concurrency, and partial-failure behavior;
- security, secrets, permissions, and input validation;
- logging, metrics, alerting, and runbook impact;
- feature flag, canary, rollback, or compensating action where appropriate;
- unrelated files, formatting, generated content, or dependency churn.

A passing test suite is evidence, not proof. Review the diff and acceptance criteria directly.
