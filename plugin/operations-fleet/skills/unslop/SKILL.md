---
name: unslop
description: Edit or draft user-facing operational prose so it is direct, concise, evidence-based, and easy to scan. Use for explanations, status updates, decisions, ticket comments, emails, reports, runbooks, and other narrative output. Do not use for code-only responses, raw logs, SQL, configuration, machine-readable artifacts, or text that must remain verbatim.
metadata:
  category: modular
---

# Write direct operational prose

Improve the narrative without changing the underlying operational result.

## Method

1. Identify the audience, purpose, required format, verified facts, assumptions, judgments, and unresolved gaps.
2. Preserve exact technical material. Do not rewrite identifiers, code, SQL, JSON, YAML, commands, logs, quotations, citations, schemas, required templates, recipients, attachments, timestamps, or state labels.
3. Lead with the outcome, decision, current state, or required action.
4. Remove filler, repetition, promotional language, vague attribution, unsupported significance, and conclusions that merely restate the response.
5. Use short paragraphs and sentence-case headings. Use a table only when repeated fields or direct comparisons become easier to scan. Use ordered steps when sequence matters.
6. Keep claims traceable to evidence. Mark an assumption, judgment, or evidence gap once and plainly. Do not invent examples, facts, baselines, thresholds, owners, dates, or next steps.
7. Check that the edit preserved the requested genre, technical meaning, authorization state, uncertainty, and required action.

For a substantial narrative or rewrite, read [editorial patterns](references/editorial-patterns.md). A short factual response can apply this entrypoint directly.

## Boundaries

- Required provider formats and organizational templates take precedence over style preferences.
- Do not soften operational state. Distinguish proposed, approved, attempted, applied, and independently verified.
- Do not turn a draft into an action, an observation into a cause, or a recommendation into approval.
- Return the edited content. Explain editing choices only when the user asks or a material ambiguity remains.
