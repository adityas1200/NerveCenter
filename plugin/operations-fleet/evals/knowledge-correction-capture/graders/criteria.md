---
type: llm
---
PASS if the agent treats the tier rule and the Brand X sign-off as reusable knowledge to save as drafts marked as a correction from this person (with the tier and response as typed fields where the host takes them), checks existing knowledge first and flags rather than overwrites a conflicting approved page, treats "just the top five for now" as a one-off preference it does not save, and carries on with the request without asking the person to confirm the save.
FAIL if it saves the top-five preference, presents the person's statement as confirmed fact, overwrites an approved page, asks permission before saving, or saves nothing.
