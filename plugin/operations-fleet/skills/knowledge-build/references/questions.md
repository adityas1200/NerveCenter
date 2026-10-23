# Interview questions

People give vague answers to broad questions ("how is your orchestration set up?") and rich ones to specific questions about something they did. So the agent answers the broad questions itself from the systems and asks people to confirm, and spends interview time on specifics.

## Two kinds

| Kind | Use for | Shape |
|---|---|---|
| Confirm or correct | Facts the agent already believes from systems and documents | "Confirm: every load runs from the orchestrator in production and deploys from the main branch. Anything that does not?" |
| Specific | Gaps, odd fixes, decisions, tacit judgement | Anchored on one ticket, job, or document; asks what the person noticed, checked, and chose |

## Rules

- One thing per question. Split anything joined by "and".
- Name the evidence: the ticket id, the job, the document and section. It jogs memory and makes the transcript easy to match.
- Offer options built from the evidence when you have them, plus "something else" and "don't remember". A "don't remember" leaves the gap open; it is not knowledge.
- Say who in the room is most likely to know (a role, or a person the evidence names). Ask about a role, not to test a person.
- Priority: high when it changes how an incident is handled or who is called; medium for definitions and ownership; low for history.
- About 15 to 20 questions fit an hour. Group them by theme so each person attends only their part, and ask the facilitator to say each id aloud ("G-7").

## Themes the systems cannot answer

Make sure a round covers these; no system holds them:

- **Business map:** which brands or products, markets and affiliates matter most, and their calendar (launches, quarter closes, board reports).
- **Who asks:** the stakeholders by tier, how fast each tier expects an answer, and who can override a priority.
- **SLAs:** when each key output must be ready, and what happens when it is late (who is told, by whom).
- **Vendors:** who supplies each feed, when it usually arrives, and the contact route when it does not.
- **Vague asks:** two or three real requests in the requester's own words, and what each turned into in data.
- **Legacy:** the migration date, and what from before it still holds.

## Probes that get the rich answers

Use one or two follow-ups on a specific question, not all of them:

- What did you notice first? What told you it was this and not something else?
- What did you check, and in what order?
- What else could you have done, and why not that?
- What would a new person get wrong here?
- Is that the usual way, or was this one different?
- Why does that matter? (moves up to the rule behind it) / Can you give an example? (moves down to the concrete case)

## Examples

| Weak | Better |
|---|---|
| How do you handle pipeline failures? | When the sales load failed on 12 March (INC-4821), what did you check first, and how did you know it was the upstream file? |
| Who owns data quality? | Confirm: the DQ rules on sales tables are owned by Data Ops, and failures go to their on-call. Who decides when a rule's threshold changes? |
| Tell us about your environments. | The jobs list shows dev and prod workspaces but no test. Do changes go straight from dev to prod, and who approves that? |
