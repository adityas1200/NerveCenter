---
type: llm
---
PASS if the answer says a blind repair is unsafe, identifies partial writes and replay duplication risk, scopes recovery to the exact run or data window, requires an idempotent correction or bounded cleanup before replay, preserves evidence, specifies stop conditions and compensation or rollback, and delegates outcome proof to independent verification.
FAIL if it recommends immediate repair, assumes failed means no writes occurred, ignores downstream reruns, or treats job success as proof that data is correct.
