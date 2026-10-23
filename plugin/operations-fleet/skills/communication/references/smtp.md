# SMTP delivery

SMTP delivery is a material external write. Resolve `communication` and
`policy.email_send` from `operations.yaml` before running the sender.

## Required safeguards

- Build and review the `.eml` with `scripts/build_preview.py` first.
- Show the exact sender, recipients, subject, attachments, and preview SHA-256.
- Resolve `policy.email_send`: with `allow`, the agent may continue without a
  separate user turn; with `ask`, send only after that exact preview and
  recipient set is approved (through the host's approval prompt when the host
  gates email, otherwise an explicit yes in chat); with `deny`, do not send.
- Pass the approved preview SHA-256 to the sender; any subsequent preview change
  invalidates the approval.
- Restrict recipients to the configured internal recipient groups when
  `external_recipients` is denied.
- Do not retry when the SMTP result is ambiguous. Inspect the attempt record and
  obtain delivery evidence before another attempt.
- Before you ask anyone to approve a send, run `scripts/send_email.py --check`
  (workspace and operations flags only). It prints the resolved server, sender
  and internal domains and proves the server answers. If it reports that the
  server did not answer or refused the connection, stop there: tell the person
  the exact host, port and error, and that the network route from this machine
  to the mail server needs fixing. Never look for another relay, port, outbox or
  sender address, and never send from a different account.

## Configuration

`scripts/send_email.py` reads the active workspace `operations.yaml`:

```yaml
communication:
  platform: smtp
  notifications_enabled: true
  sender: sender@example.com
  recipient_groups:
    operations_team: [recipient@example.com]
  smtp:
    host: smtp.example.com
    port: 25
    use_tls: false      # or security: starttls | ssl | none, and username: ...
policy:
  email_send: ask
```

Environment variables override the corresponding non-secret values when set:
`EMAIL_NOTIFICATIONS_ENABLED`, `EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURITY`, `SMTP_USE_TLS`, and `SMTP_USERNAME`. `SMTP_PASSWORD` (secret) and
`SMTP_CA_FILE` (custom CA bundle) are read from the environment only. A deployment
that sets these needs nothing under `communication.smtp`; only
`communication.sender` (and, optionally, recipient groups) has to be in
`operations.yaml`.

Security is `ssl` (implicit TLS), `starttls` or `none`. When `security` is not
set, `use_tls: true` means `starttls`, otherwise `none`. An explicit port always
wins. With no port, an explicit `security` defaults to 465 (`ssl`), 587
(`starttls`) or 25 (`none`); without an explicit `security` the port stays 25. When a username is set the sender logs in
with it and `SMTP_PASSWORD`; it refuses to do so without TLS unless the host is
loopback.

Recipients count as internal when they are in a recipient group, in
`communication.internal_domains`, or in the sender's own domain.

`scripts/send_email.py --check` resolves all of this and connects to the server
without sending. Every send also runs that connection check first, so an
unreachable server fails in seconds with a plain message and leaves no
`send-record.json` behind; fix the network route and rerun the same send.

## Send command

For a generated document, build the preview from a named template and the
artifact manifest returned by `documents`:

```json
{
  "case_id": "CASE-1234",
  "preview_id": "document-delivery-1",
  "from": "sender@example.com",
  "to": ["recipient@example.com"],
  "template": {
    "name": "document-delivery",
    "variables": {
      "case_id": "CASE-1234",
      "short_outcome": "incident report",
      "status": "Done and independently verified",
      "completed": "The requested report was generated.",
      "verification": "The final pages and source totals were checked.",
      "deliverables": "incident-report.pdf",
      "action_required": "No action required.",
      "reference": "CASE-1234"
    }
  },
  "attachments": [
    {"manifest": "artifacts/CASE-1234/incident-report-artifact.json"}
  ]
}
```

Run `build_preview.py --input <request.json>` and review the resulting manifest
before delivery. Named templates reject direct `subject`, `text`, or `html`
overrides. Template values are HTML-escaped in the HTML part.

Then send the unchanged preview:

```text
python scripts/send_email.py \
  --workspace <workspace> \
  --operations <workspace>/operations.yaml \
  --manifest <workspace>/artifacts/<case>/<preview>/manifest.json \
  --approved-eml-sha256 <reviewed-sha256> \
  --confirm-send
```

The sender refuses disabled notifications, a non-SMTP provider, `email_send:
deny`, sender or recipient mismatches, changed previews, duplicate attempts, and
invalid SMTP settings. Under `allow`, `--confirm-send` records the agent's
policy-authorized decision to send the validated artifact; under `ask`, it
records the user's approval of that artifact. A successful call writes
`send-record.json` beside the manifest.
