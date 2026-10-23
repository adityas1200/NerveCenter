---
name: communication
description: Draft, review, preview, or send a clear operational email or collaboration message using verified facts and exact attachments. Use for ticket updates, incidents, access completion, releases, weekly reports, stakeholder summaries, requests for information, Teams, Slack, and similar communication.
metadata:
  category: sequential
---

# Communicate operational work

Make the message useful to the reader, not a transcript of the work.

## Method

1. Resolve the message type, purpose, audience, sender, recipients or channel, sensitivity, required action, and current state. Do not guess a person or destination from an ambiguous name.
2. Retrieve the relevant communication policy, tone, aliases, and approved template.
3. Create a fact table before drafting:

```text
Fact | evidence | state | safe wording
```

Use precise state language: observed, investigating, attempted, accepted, applied, verified, blocked, planned. Never say fixed when only a request, deployment, or retry was accepted.
4. Choose the shortest format that still gives the audience what it needs. Link to the RCA or report instead of pasting long analysis.
5. Use absolute timestamps and timezone for incidents and time-sensitive work.
6. Review the draft for unsupported claims, unnecessary detail, missing action, incorrect audience, confidentiality, and tone. Use `research` only when the message needs a current public fact; cite it as a proper link (never a bare pasted URL, which breaks in some renderers) and never search private message content.
7. Load and apply `unslop` to the user-facing draft before preview or approval. Preserve the exact recipients, sender, subject, attachments, links, dates, identifiers, state language, and required template fields.

Email about a ticket change only when the person asks, or when `operations.yaml`
or approved knowledge says ticket changes are announced by email; build it from
the ticket read-back. Read [operational message patterns](references/operational-messages.md)
and [incident updates](references/incident-updates.md) for each message type's shape.

## Preview and send

- Keep HTML and plain text factually equivalent.
- Prefer a named template over assembling repeated operational emails ad hoc. For
  document delivery, use the bundled `document-delivery` template and provide
  all required variables; do not mix template input with direct subject or body
  fields.
- Attach or link the exact reviewed artifact. When `documents` produced a local
  file, consume its artifact manifest so path, ready state, size, media type,
  and SHA-256 are verified again while building the preview.
- Always build and validate the preview first. Then state the sender,
  recipients, subject, attachments, and preview SHA-256 in one sentence and
  follow the approval rules in [reply format](../orchestrate/references/reply-format.md#approvals-and-writes):
  under `allow` send in the same run; when the host gates email with its own
  approval, that prompt is the approval, so do not also ask in chat; without a
  host gate and with `policy.email_send: ask`, wait for an explicit yes; under
  `deny`, do not send.
- Send only the unchanged validated preview to the exact resolved recipients.
- Read back the provider message or sent record before retrying an ambiguous result.
- Never describe a preview as sent. When policy, approval, configuration, or delivery evidence prevents a send the person asked for, say so plainly with the smallest next action.

The scripts live in this skill's `scripts/` folder (run them by that path, not
from the workspace). `render_email.py` turns one JSON document into a branded
`email.html` and `email.txt`; read [HTML email](references/html-email.md).
`build_preview.py` builds a deterministic local `.eml` preview; it never sends
mail and supports bundled named templates plus document artifact manifests. When
the configured provider is SMTP and the active policy authorizes the exact
validated preview, use `send_email.py`; read [SMTP delivery](references/smtp.md)
before sending. When the host offers `show_artifact`, show the rendered
`email.html` with it so the person reviews the message as the recipient will see it.
