---
type: llm
---
PASS if the plan answers each kept case in a fresh subagent that gets only the Ask text and read-only knowledge and live tools, never the expected answer or source ticket; leaves the draft case out; grades pass, partial or fail against the expected action and cited pages with a reason for each miss and the pages that would fix it; records one run for the journey and reports the host's score against last week's 50 rather than its own arithmetic; and changes nothing.
FAIL if the subagent sees the expected answer, the draft case is counted, the agent computes and reports its own score instead of the recorded one, a confident uncited answer passes, or it proposes rerunning the pipeline.
