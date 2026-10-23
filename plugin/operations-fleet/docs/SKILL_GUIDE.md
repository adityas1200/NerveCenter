# Skill-writing guide

A skill is worthwhile only when it makes a realistic result materially better than plain Claude.

## Design around a recognizable task

Each skill must have one clear user goal and a description that states both what it does and when to use it. The description is the primary trigger, so include realistic phrases and contexts without turning it into a keyword dump.

A strong skill makes these boundaries clear:

- expected inputs;
- expert decisions and workflow;
- output the user receives;
- facts that must not be inferred;
- when to ask, stop, or decline;
- references, assets, or scripts to use.

## Keep the main skill lean

Use progressive disclosure:

```text
SKILL.md             short expert method and quality bar
references/          provider details, examples, policies, deep guidance
assets/              templates copied or transformed into outputs
scripts/             deterministic validation or file processing
```

Do not repeat normal model behavior, client mappings, credentials, or a provider's full documentation in `SKILL.md`.

## Write expert decisions, not generic steps

Useful instructions change behavior. Examples:

- compare last good with first bad;
- distinguish trigger from causal mechanism;
- inspect direct and effective access;
- verify replay safety before a job repair;
- promote the exact tested artifact;
- recalculate a workbook and inspect formula errors;
- render every slide before calling a deck ready;
- distinguish accepted, applied, and verified in communication.

Weak instructions such as "analyze carefully," "follow best practices," or "be professional" add little value unless the skill defines what that means for the task.

## Use scripts only for deterministic work

Scripts are appropriate for exact tasks such as digest checks, workspace validation, MCP rendering, formula inspection, or email preview construction. Do not create a framework when the model and existing tools can complete the task reliably.

## Freshness

Use the `research` skill when public facts may have changed. Prefer official primary sources, cite material claims, and keep private data out of searches. Put stable organization-specific guidance in knowledge rather than hard-coding it in the plugin.

## Simple language

Use imperative sentences, familiar terms, short sections, and concrete output shapes. Explain why a non-obvious rule matters. Avoid invented jargon, repeated policy text, and metadata that does not change behavior.

## Evaluate with and without the skill

Create substantive prompts that require the expert method. Compare:

- correctness and completeness;
- evidence quality;
- unsupported assumptions;
- provider-specific mistakes;
- output usefulness;
- unnecessary verbosity;
- number of follow-up prompts;
- safe handling of ambiguity and writes.

Rewrite or remove a skill that does not beat the baseline consistently.

## Review checklist

- Does the description trigger on the right requests?
- Is the task generic across clients but specific enough to add expertise?
- Are provider details in references rather than the main workflow?
- Are outputs and stop conditions explicit?
- Is current public information researched only when needed?
- Are untrusted inputs treated as data?
- Does a write have authority, read-back, and verification?
- Can a normal operator understand the result?
- Does an eval demonstrate value?

Primary references:

- [OpenAI: Build skills](https://developers.openai.com/plugins/build/skills)
- [OpenAI: Skills](https://developers.openai.com/plugins/concepts/skills)
- [Anthropic: Claude Code skills](https://code.claude.com/docs/en/skills)
- [Anthropic skill examples](https://github.com/anthropics/skills)
- [Agent Skills specification](https://agentskills.io/specification)
