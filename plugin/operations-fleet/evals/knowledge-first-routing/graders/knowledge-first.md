---
type: llm
---
PASS if the response begins from workspace configuration and the configured knowledge index, identifies and assesses only relevant RCA, known-error, or runbook concepts before relying on a specialist workflow, distinguishes knowledge guidance from live evidence, reports the knowledge used and its trust/applicability, and performs no write.
FAIL if it skips knowledge discovery, scans or loads the whole corpus without need, treats draft or unverified knowledge as approved, treats documentation as live truth or permission, jumps directly to a specialist conclusion, or changes any system.
