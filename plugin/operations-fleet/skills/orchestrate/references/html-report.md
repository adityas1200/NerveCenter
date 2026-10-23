# HTML report artifact

When a result has more than a headline and a few numbers (an investigation, a data pull, a weekly
report, a comparison), write it as one self-contained HTML file in the task folder and show it with
`mcp__nervecenter__show_artifact`. The host app renders the file inline in the task, sandboxed, so
the reader gets a document they can scan, not a wall of markdown. Keep the chat reply to the
headline, the two or three facts that change a decision, and the next actions; the report holds the rest.
It is the task's one write-up file: do not also write `report.md` (see [reply format](reply-format.md)).

## Rules

- One file, `tasks/<task>/report.html` (or `<purpose>.html`), under 400 KB, no external requests:
  inline CSS only, no `<script>` (scripts do not run in the viewer), no web fonts, images as inline
  SVG or data URIs. Charts are inline SVG you write yourself (bars, columns, a line, a donut); no
  chart libraries.
- Plain words for a business reader. Absolute timestamps with the timezone. Every number has a unit
  or a comparison. No narration of the steps taken.
- Layout: max width 960px, white cards with a 1px `#E3E6EC` border and 8px radius on a `#F4F5F8`
  page, 24px padding, `font-family: 'DM Sans','Segoe UI',Helvetica,Arial,sans-serif`, text `#101828`,
  muted `#667085`, hairlines `#E3E6EC`. Brand accent `#6366F1` (override from `operations.yaml`
  `branding.accent` when set). Colour only on status words and numbers that carry a tone:
  good `#059669`, warning `#B45309` on `#FEF3C7`, bad `#B91C1C` on `#FEE2E2`, neutral grey.
- Order: status chip, title, one-paragraph summary, metric tiles (2-4), then sections in the order
  the reader needs them (Impact, Evidence, Root cause, Timeline, What to do next). Tables under 15
  rows; longer data goes to a CSV and the table shows totals or the top rows.
- Same facts as the chat reply and any email. Never a number in one place that is not in the others.

## Skeleton

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{{title}}</title>
<style>
  body{margin:0;background:#F4F5F8;color:#101828;font-family:'DM Sans','Segoe UI',Helvetica,Arial,sans-serif;font-size:14.5px;line-height:1.55}
  .page{max-width:960px;margin:0 auto;padding:24px 16px}
  .card{background:#fff;border:1px solid #E3E6EC;border-radius:8px;padding:20px 24px;margin:0 0 16px}
  .brand{font-weight:700;border-bottom:3px solid #6366F1;padding-bottom:12px;margin-bottom:16px}
  .chip{display:inline-block;font-size:12px;font-weight:600;padding:3px 10px;border-radius:12px;background:#EEF2FF;color:#3730A3}
  .chip.warning{background:#FEF3C7;color:#92400E}.chip.bad{background:#FEE2E2;color:#991B1B}.chip.good{background:#D1FAE5;color:#065F46}
  h1{font-size:22px;line-height:1.3;margin:12px 0 8px}h2{font-size:15px;margin:0 0 10px;color:#344054;text-transform:uppercase;letter-spacing:.04em}
  p{margin:0 0 10px}.muted{color:#667085}
  .tiles{display:flex;gap:12px;flex-wrap:wrap}.tile{flex:1 1 160px;border:1px solid #E3E6EC;border-radius:8px;padding:12px 14px}
  .tile .label{font-size:12.5px;color:#667085}.tile .value{font-size:26px;font-weight:600;margin:4px 0 2px}.tile .note{font-size:12.5px;color:#667085}
  .value.good{color:#059669}.value.bad{color:#B91C1C}.value.warning{color:#B45309}
  table{width:100%;border-collapse:collapse;font-size:13.5px}th{text-align:left;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:#667085;padding:8px 10px;border-bottom:1px solid #E3E6EC}
  td{padding:9px 10px;border-bottom:1px solid #F0F2F5;vertical-align:top}td.num{text-align:right;font-variant-numeric:tabular-nums}
  .status{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:600}
  .status.failed{background:#FEE2E2;color:#991B1B}.status.healthy{background:#D1FAE5;color:#065F46}.status.warning{background:#FEF3C7;color:#92400E}
  .bar{display:flex;align-items:center;gap:10px;margin:6px 0}.bar .name{width:180px;color:#344054}.bar .track{flex:1;height:8px;background:#F0F2F5;border-radius:4px}.bar .fill{height:8px;border-radius:4px;background:#6366F1}.bar .n{width:60px;text-align:right;font-variant-numeric:tabular-nums}
  ol.actions li{margin:0 0 8px}.footer{font-size:12.5px;color:#667085;margin-top:8px}
</style></head>
<body><div class="page">
  <div class="card">
    <div class="brand">{{team name from operations.yaml, or the product name}}</div>
    <span class="chip warning">{{status line}}</span>
    <h1>{{title}}</h1>
    <p>{{one-paragraph summary: what happened, what it affects, what the reader must do}}</p>
    <div class="tiles">
      <div class="tile"><div class="label">Rows loaded</div><div class="value bad">0</div><div class="note">expected ~480k</div></div>
    </div>
  </div>
  <div class="card"><h2>Evidence</h2>
    <table><thead><tr><th>Run</th><th>Started (UTC)</th><th>Status</th><th class="num">Duration</th></tr></thead>
    <tbody><tr><td>{{run id}}</td><td>{{start time}}</td><td><span class="status failed">Failed</span></td><td class="num">6m</td></tr></tbody></table>
  </div>
  <div class="card"><h2>Share by table</h2>
    <div class="bar"><span class="name">{{table name}}</span><span class="track"><span class="fill" style="width:60%"></span></span><span class="n">6</span></div>
  </div>
  <div class="card"><h2>What to do next</h2>
    <ol class="actions"><li><strong>{{owner}}</strong> {{does what}}; {{how anyone will know it worked}}.</li></ol>
    <p class="footer">Prepared by {{agent name}} · {{absolute time with timezone}} · {{task or ticket id}}</p>
  </div>
</div></body></html>
```

For a column or line chart, draw inline SVG: a 640x200 viewBox, a hairline baseline, one `<rect>`
per column (or one `<path>` per series), labels in 11px `#667085`, values above the columns when
there are fewer than ten. Keep the palette above.
