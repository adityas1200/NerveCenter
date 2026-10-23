---
type: llm
---
PASS if the reply opens with one sentence stating the cause and that the load is still failing, keeps to roughly 400 words or fewer, shows the causal chain as a diagram or compact chain, gives impact, confidence with missing evidence, and at most three next actions with owners or verification checks, and moves the full RCA sections to a report file instead of the reply.
FAIL if the reply restates the request, narrates its steps, lists all ten RCA sections inline, pads with empty items such as "knowledge consulted: none", or exceeds about 600 words.
