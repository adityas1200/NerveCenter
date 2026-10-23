# HTML email

`scripts/render_email.py` turns one JSON document into `email.html` and `email.txt`. The layout uses tables and inline styles only, because Outlook ignores flexbox, grid, and style sheets, and many clients strip `<style>` blocks.

## Content

```json
{
  "brand": {"name": "Acme Data Ops", "accent": "#4F46E5", "font": "DM Sans", "logo_url": "", "footer": "Acme Data Operations"},
  "preheader": "Inbox preview text; defaults to the summary",
  "status": {"label": "Fix applied, not yet verified", "tone": "warning"},
  "title": "Daily orders load failed on 22 Sep",
  "summary": "The load failed at 06:12 UTC because `region_cd` was renamed upstream. Order dashboards show data up to 21 Sep.",
  "metrics": [{"label": "Rows loaded", "value": "0", "note": "expected ~48,000", "tone": "bad"}],
  "sections": [
    {"heading": "Impact", "paragraphs": ["..."], "bullets": ["..."]},
    {"heading": "Runs", "table": {"columns": ["Run", "Started (UTC)", "State"], "rows": [["88213", "22 Sep 06:00", "Failed"]]}},
    {"heading": "Share by region", "bars": {"unit": "%", "items": [{"label": "North", "value": 42}]}}
  ],
  "actions": [{"text": "Approve the column mapping fix", "owner": "Data platform lead", "due": "23 Sep 12:00 UTC"}],
  "links": [{"label": "Full RCA", "url": "https://..."}],
  "attachments": [{"name": "orders-by-region-2026-W38.csv", "size": "412 KB", "description": "one row per region and day"}],
  "footer": "Overrides brand.footer"
}
```

Every field except `title` is optional. Tones are `good`, `warning`, `bad`, `info`, and `neutral`. Text fields accept `**bold**` and `` `code` ``. Everything else is escaped. Links must be `https`, `http`, or `mailto`.

## Writing

- The subject says what changed or what is needed, with the record ID: `[INC0012345] Daily orders load failed, fix not yet verified`.
- The status label uses the communication state words, and the tone matches the state. `good` means verified.
- The summary answers what happened, what it affects, and what the reader must do, in at most three sentences.
- Use metrics only for numbers the reader acts on. Each needs a unit or a comparison in its note.
- Keep tables to 15 rows. Put longer data in an attachment and show the totals or the top rows.
- Use bars for a share or a comparison across a few items. Do not use them for a time series; attach a chart image instead.
- Mermaid does not render in email. Replace a diagram with a short table or numbered steps.
- Actions name an owner and a date whenever the facts provide one. Never invent either.

## Check before sending

- Open `email.html` and read it once as the recipient would.
- Confirm that `email.txt` carries the same facts.
- Confirm every attachment named in the body is in the preview manifest, with the reviewed digest.
- Confirm that the recipients match the resolved groups and the data-sharing rules.
