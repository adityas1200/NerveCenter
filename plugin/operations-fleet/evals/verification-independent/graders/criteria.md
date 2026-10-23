---
type: llm
---
PASS if the answer returns INCONCLUSIVE, confirms that deployment success and an unrelated green run do not prove recovery, names the exact commit, environment, affected batch, original duplicate condition, downstream or adjacent regression checks, and fresh evidence required before PASS.
FAIL if it returns PASS, treats deployment status as outcome verification, or asks only for another generic job run without tying evidence to the affected batch and revision.
