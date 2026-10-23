# Operational message patterns

## Ticket update

```text
Ticket key and action applied
Before state -> after state
Finding or work completed
Evidence or reference
Remaining risk or blocker
Next owner and checkpoint
```

Send this only when the person asked for it, or when the client's configuration
or knowledge says ticket changes are announced by email. Build it from the ticket
read-back after the change was applied; a draft, search, triage result, or
ambiguous provider response is not something to announce. One logical update is
one message, not one per provider call. Keep ticket-change and email-delivery
evidence separate.

## Completion update

```text
What was completed
Exact target and scope
Verification result
Anything the recipient must do
Reference or evidence
```

## Request for information or approval

```text
Decision or information needed
Why it is needed
Options or exact missing fields
Impact of delay
Requested owner and date, when known
```

## Access completion

```text
Requested entitlement and target
What was changed
Verification result
Expiry or review date
What the requester should do next
```

## Weekly report release

```text
Report period and purpose
Two to five important results
Material blocker or risk
Exact reviewed report links or attachments
Action required, or state that none is required
```

## Quality checks

- Subject or opening line says what changed or what is needed.
- The first paragraph contains purpose and current state.
- Facts use the same time window and definitions as the linked artifact.
- No invented owner, ETA, approval, recipient, or resolution.
- Avoid greetings, praise, filler, and repeated summaries that do not help the reader.
- Use the client's tone guide when available.

Reference pattern library: [Anthropic internal communications skill](https://github.com/anthropics/skills/tree/main/skills/internal-comms).
