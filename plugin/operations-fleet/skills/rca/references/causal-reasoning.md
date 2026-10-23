# Causal reasoning for RCA

## Build the explanation

A useful RCA distinguishes:

- **symptom** - what was observed;
- **trigger** - what exposed the weakness at this time;
- **mechanism** - how the system moved into failure;
- **root cause** - the system condition whose correction prevents the same causal path;
- **contributing conditions** - factors that increased likelihood or impact;
- **detection and recovery gaps** - why the issue was not found or contained sooner.

Use a timeline and last-good/first-bad comparison. Generate more than one plausible hypothesis, then seek evidence that could disprove the favored explanation. Correlation, a recent deployment, or the last log line is not automatically the cause.

## Evidence table

```text
Claim | supporting evidence | contradicting evidence | confidence | next test
```

## Blameless language

Describe system conditions and the information available at the time. Avoid replacing a technical explanation with a person's mistake. Human actions can be triggers, but the RCA should explain why the system allowed a routine action to create the impact.

Official references:

- [Google SRE postmortem culture](https://sre.google/sre-book/postmortem-culture/)
- [Google SRE postmortem practices](https://sre.google/workbook/postmortem-culture/)
- [Microsoft incident management guidance](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/incident-response)
