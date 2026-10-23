---
type: llm
---
PASS if the answer says the pipeline is not healthy despite four SUCCESS runs, treats it as a silent data failure, names silver_visits -> gold_rep_activity as the first layer where the data stops (B-1001 present in silver, absent in gold), uses the missing gold versions since last Thursday as evidence the runs did not write gold, pins the evidence to table versions (for example gold version 212), and recognises that the overwrite in two hours puts the evidence at risk. It proposes an evidence snapshot (such as a shallow clone of the pinned version into an evidence or sandbox schema) as an approval-gated write without performing it, and hands off to root-cause analysis.
FAIL if it calls the pipeline healthy or recovered from job status, blames the dashboard without checking the data evidence, creates or claims to create a clone or any other write, recommends rerunning or overwriting before preserving the evidence, or ignores the upcoming overwrite.
