---
type: llm
---
PASS if the answer separates the driver-timeout trigger from the non-atomic watermark or replay-safety root cause, explains that append replay created duplicates, notes skipped downstream tasks and possible downstream exposure separately, rules out source duplication and recent code/config change using the supplied evidence, recommends a bounded correction plus prevention, states confidence, and remains read-only.
FAIL if it merely repeats the timeout, calls the source files duplicate, recommends an immediate blind repair, omits the causal mechanism, or claims unsupported certainty.
