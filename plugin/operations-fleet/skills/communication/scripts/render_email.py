#!/usr/bin/env python3
"""Render an operational email as email-client-safe HTML plus an equivalent plain-text body.

Input is JSON (see the communication skill's html-email reference). The layout uses tables and inline
styles only, so it holds up in Outlook, Gmail and mobile clients. Both bodies come from the same
content, so they cannot drift apart. The script writes files only; it never delivers mail.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

TONES = {
    "good": ("#E7F6EC", "#166534"),
    "warning": ("#FEF3C7", "#92400E"),
    "bad": ("#FEE2E2", "#991B1B"),
    "info": ("#E0E7FF", "#3730A3"),
    "neutral": ("#F1F3F6", "#344054"),
}
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
SAFE_URL = re.compile(r"^(https?://|mailto:)", re.IGNORECASE)
INLINE = re.compile(r"\*\*(.+?)\*\*|`([^`]+)`")
DEFAULT_BRAND = {"name": "Operations", "accent": "#2563EB", "font": "", "logo_url": "", "footer": ""}
INK, MUTED, LINE, SURFACE = "#101828", "#5D6B7E", "#E3E6EC", "#F4F5F8"
LONG_TABLE = 15


class RenderError(ValueError):
    pass


def text(value: Any, field: str, required: bool = False) -> str:
    if value is None or value == "":
        if required:
            raise RenderError(f"{field} is required")
        return ""
    if not isinstance(value, (str, int, float)):
        raise RenderError(f"{field} must be text")
    return str(value).strip()


def items(value: Any, field: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise RenderError(f"{field} must be a list")
    return value


def rich(value: str) -> str:
    """Escape, then allow **bold** and `code` only."""
    out, last = [], 0
    for match in INLINE.finditer(value):
        out.append(html.escape(value[last:match.start()]))
        if match.group(1) is not None:
            out.append(f'<strong style="color:{INK};">{html.escape(match.group(1))}</strong>')
        else:
            out.append(f'<code style="font-family:Consolas,Menlo,monospace;font-size:13px;background:{SURFACE};padding:1px 4px;">{html.escape(match.group(2))}</code>')
        last = match.end()
    out.append(html.escape(value[last:]))
    return "".join(out)


def plain(value: str) -> str:
    return INLINE.sub(lambda match: match.group(1) or match.group(2), value)


def url(value: Any, field: str) -> str:
    link = text(value, field, required=True)
    if not SAFE_URL.match(link):
        raise RenderError(f"{field} must be an http, https, or mailto link")
    return link


def tone(value: Any, field: str) -> tuple[str, str]:
    name = text(value, field) or "neutral"
    if name not in TONES:
        raise RenderError(f"{field} must be one of {', '.join(TONES)}")
    return TONES[name]


def brand_of(content: dict[str, Any]) -> dict[str, str]:
    brand = {**DEFAULT_BRAND, **{key: text(value, f"brand.{key}") for key, value in (content.get("brand") or {}).items() if key in DEFAULT_BRAND}}
    if not HEX.match(brand["accent"]):
        raise RenderError("brand.accent must be a #RRGGBB colour")
    if not re.fullmatch(r"[A-Za-z0-9 -]*", brand["font"]):
        raise RenderError("brand.font must be a plain font family name")
    if brand["logo_url"]:
        brand["logo_url"] = url(brand["logo_url"], "brand.logo_url")
    return brand


def table_html(table: dict[str, Any], field: str, warnings: list[str]) -> str:
    columns = [text(column, f"{field}.columns") for column in items(table.get("columns"), f"{field}.columns")]
    rows = items(table.get("rows"), f"{field}.rows")
    if not columns:
        raise RenderError(f"{field}.columns is required")
    if len(rows) > LONG_TABLE:
        warnings.append(f"{field} has {len(rows)} rows; put long tables in an attachment and show the top rows or totals")
    numeric = [all(re.fullmatch(r"[-+]?[\d,.]+%?", text(row[i], field)) for row in rows if i < len(row) and text(row[i], field)) and bool(rows) for i in range(len(columns))]
    # The first column labels the row (a run, ticket or region), so it stays left even when it is a number.
    align = lambda i: "right" if numeric[i] and i > 0 else "left"
    head = "".join(f'<th align="{align(i)}" style="padding:8px 10px;border-bottom:1px solid {LINE};font-size:12px;font-weight:600;color:{MUTED};text-align:{align(i)};">{html.escape(column)}</th>' for i, column in enumerate(columns))
    body = []
    for r, row in enumerate(rows):
        cells = items(row, f"{field}.rows[{r}]")
        if len(cells) != len(columns):
            raise RenderError(f"{field}.rows[{r}] has {len(cells)} cells for {len(columns)} columns")
        body.append("<tr>" + "".join(f'<td align="{align(i)}" style="padding:8px 10px;border-bottom:1px solid {LINE};font-size:14px;color:{INK};text-align:{align(i)};">{rich(text(cell, field))}</td>' for i, cell in enumerate(cells)) + "</tr>")
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:4px 0 8px;"><tr>{head}</tr>{"".join(body)}</table>'


def table_text(table: dict[str, Any]) -> list[str]:
    columns = [str(column) for column in table.get("columns") or []]
    rows = [[plain(str(cell)) for cell in row] for row in table.get("rows") or []]
    widths = [max([len(columns[i])] + [len(row[i]) for row in rows]) for i in range(len(columns))]
    line = lambda cells: "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells)).rstrip()
    return [line(columns), line(["-" * width for width in widths]), *[line(row) for row in rows]]


def bars_html(bars: dict[str, Any], field: str, accent: str) -> str:
    unit = text(bars.get("unit"), f"{field}.unit")
    entries = []
    for i, entry in enumerate(items(bars.get("items"), f"{field}.items")):
        value = entry.get("value") if isinstance(entry, dict) else None
        if not isinstance(value, (int, float)) or value < 0:
            raise RenderError(f"{field}.items[{i}].value must be a non-negative number")
        entries.append((text(entry.get("label"), f"{field}.items[{i}].label", required=True), float(value)))
    top = max((value for _, value in entries), default=0) or 1
    rows = []
    for label, value in entries:
        width = max(1, round(value / top * 100))
        shown = f"{value:g}{unit}"
        rows.append(
            f'<tr><td width="30%" style="padding:4px 10px 4px 0;font-size:13px;color:{INK};">{html.escape(label)}</td>'
            f'<td style="padding:4px 0;"><table role="presentation" width="{width}%" cellpadding="0" cellspacing="0" border="0"><tr><td height="12" bgcolor="{accent}" style="background:{accent};font-size:0;line-height:0;">&nbsp;</td></tr></table></td>'
            f'<td width="18%" align="right" style="padding:4px 0 4px 10px;font-size:13px;color:{INK};">{html.escape(shown)}</td></tr>'
        )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;">{"".join(rows)}</table>'


def render(content: dict[str, Any]) -> tuple[str, str, list[str]]:
    if not isinstance(content, dict):
        raise RenderError("input must be a JSON object")
    warnings: list[str] = []
    brand = brand_of(content)
    accent = brand["accent"]
    font = (f"'{brand['font']}'," if brand["font"] else "") + "'Segoe UI',Helvetica,Arial,sans-serif"
    title = text(content.get("title"), "title", required=True)
    summary = text(content.get("summary"), "summary")
    preheader = text(content.get("preheader"), "preheader") or plain(summary)[:140]
    status = content.get("status") or {}
    status_label = text(status.get("label"), "status.label")
    status_bg, status_fg = tone(status.get("tone"), "status.tone")
    metrics = items(content.get("metrics"), "metrics")
    if len(metrics) > 4:
        warnings.append("more than four metrics; keep the ones the reader acts on")
    if not summary:
        warnings.append("no summary; the first lines should say what happened and what is needed")

    h: list[str] = []
    t: list[str] = [title]
    if status_label:
        t.append(f"Status: {status_label}")
    t.append("")
    if summary:
        t += [plain(summary), ""]

    head = f'<img src="{html.escape(brand["logo_url"])}" alt="{html.escape(brand["name"])}" height="24" style="display:block;border:0;height:24px;">' if brand["logo_url"] else f'<span style="font-size:15px;font-weight:700;color:{INK};letter-spacing:-0.2px;">{html.escape(brand["name"])}</span>'
    h.append(f'<tr><td style="padding:20px 28px;border-bottom:3px solid {accent};">{head}</td></tr>')
    pill = f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr><td bgcolor="{status_bg}" style="background:{status_bg};color:{status_fg};font-size:12px;font-weight:600;padding:4px 10px;border-radius:12px;">{html.escape(status_label)}</td></tr></table>' if status_label else ""
    lead = f'<p style="margin:10px 0 0;font-size:15px;line-height:22px;color:{INK};">{rich(summary)}</p>' if summary else ""
    h.append(f'<tr><td style="padding:24px 28px 8px;">{pill}<h1 style="margin:0;font-size:21px;line-height:28px;font-weight:700;color:{INK};">{html.escape(title)}</h1>{lead}</td></tr>')

    if metrics:
        cells = []
        for i, metric in enumerate(metrics[:4]):
            if not isinstance(metric, dict):
                raise RenderError(f"metrics[{i}] must be an object")
            _, note_fg = tone(metric.get("tone"), f"metrics[{i}].tone")
            label = text(metric.get("label"), f"metrics[{i}].label", required=True)
            value = text(metric.get("value"), f"metrics[{i}].value", required=True)
            note = text(metric.get("note"), f"metrics[{i}].note")
            note_html = f'<div style="font-size:12px;color:{note_fg if metric.get("tone") else MUTED};padding-top:2px;">{html.escape(note)}</div>' if note else ""
            cells.append(f'<td valign="top" style="padding:12px 14px;background:{SURFACE};border-left:{"0" if i == 0 else "4px solid #FFFFFF"};"><div style="font-size:12px;color:{MUTED};">{html.escape(label)}</div><div style="font-size:20px;font-weight:700;color:{INK};padding-top:2px;">{html.escape(value)}</div>{note_html}</td>')
            t.append(f"{label}: {value}" + (f" ({note})" if note else ""))
        t.append("")
        h.append(f'<tr><td style="padding:16px 28px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{"".join(cells)}</tr></table></td></tr>')

    for s, section in enumerate(items(content.get("sections"), "sections")):
        if not isinstance(section, dict):
            raise RenderError(f"sections[{s}] must be an object")
        field = f"sections[{s}]"
        heading = text(section.get("heading"), f"{field}.heading")
        parts = []
        if heading:
            parts.append(f'<h2 style="margin:0 0 6px;font-size:15px;line-height:22px;font-weight:700;color:{INK};">{html.escape(heading)}</h2>')
            t += [heading.upper(), ""]
        for p, paragraph in enumerate(items(section.get("paragraphs"), f"{field}.paragraphs")):
            value = text(paragraph, f"{field}.paragraphs[{p}]", required=True)
            parts.append(f'<p style="margin:0 0 10px;font-size:14px;line-height:21px;color:{INK};">{rich(value)}</p>')
            t += [plain(value), ""]
        bullets = [text(bullet, f"{field}.bullets", required=True) for bullet in items(section.get("bullets"), f"{field}.bullets")]
        if bullets:
            parts.append('<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">' + "".join(f'<tr><td valign="top" style="padding:2px 8px 2px 0;font-size:14px;color:{accent};">&#8226;</td><td style="padding:2px 0;font-size:14px;line-height:21px;color:{INK};">{rich(bullet)}</td></tr>' for bullet in bullets) + "</table>")
            t += [f"- {plain(bullet)}" for bullet in bullets] + [""]
        if section.get("table"):
            parts.append(table_html(section["table"], f"{field}.table", warnings))
            t += table_text(section["table"]) + [""]
        if section.get("bars"):
            parts.append(bars_html(section["bars"], f"{field}.bars", accent))
            unit = text(section["bars"].get("unit"), f"{field}.bars.unit")
            t += [f"{entry['label']}: {float(entry['value']):g}{unit}" for entry in section["bars"]["items"]] + [""]
        if parts:
            h.append(f'<tr><td style="padding:16px 28px 0;">{"".join(parts)}</td></tr>')

    actions = items(content.get("actions"), "actions")
    if len(actions) > 3:
        warnings.append("more than three actions; keep the ones that must happen next")
    if actions:
        rows, t_rows = [], ["WHAT HAPPENS NEXT", ""]
        for a, action in enumerate(actions):
            if not isinstance(action, dict):
                raise RenderError(f"actions[{a}] must be an object")
            what = text(action.get("text"), f"actions[{a}].text", required=True)
            who = " · ".join(filter(None, [text(action.get("owner"), f"actions[{a}].owner"), text(action.get("due"), f"actions[{a}].due")]))
            rows.append(f'<tr><td valign="top" width="26" style="padding:6px 0;"><div style="width:20px;height:20px;line-height:20px;border-radius:10px;background:{accent};color:#FFFFFF;font-size:12px;font-weight:700;text-align:center;">{a + 1}</div></td><td style="padding:6px 0 6px 8px;font-size:14px;line-height:21px;color:{INK};">{rich(what)}' + (f'<div style="font-size:12px;color:{MUTED};">{html.escape(who)}</div>' if who else "") + "</td></tr>")
            t_rows.append(f"{a + 1}. {plain(what)}" + (f" ({who})" if who else ""))
        h.append(f'<tr><td style="padding:16px 28px 0;"><h2 style="margin:0 0 4px;font-size:15px;font-weight:700;color:{INK};">What happens next</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{"".join(rows)}</table></td></tr>')
        t += t_rows + [""]

    links = items(content.get("links"), "links")
    files = items(content.get("attachments"), "attachments")
    if links or files:
        parts, t_parts = [], []
        for l, link in enumerate(links):
            label = text(link.get("label"), f"links[{l}].label", required=True)
            href = url(link.get("url"), f"links[{l}].url")
            parts.append(f'<a href="{html.escape(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:8px 14px;border:1px solid {accent};border-radius:6px;color:{accent};font-size:13px;font-weight:600;text-decoration:none;">{html.escape(label)}</a>')
            t_parts.append(f"{label}: {href}")
        for f, item in enumerate(files):
            name = text(item.get("name"), f"attachments[{f}].name", required=True)
            detail = " · ".join(filter(None, [text(item.get("size"), f"attachments[{f}].size"), text(item.get("description"), f"attachments[{f}].description")]))
            parts.append(f'<div style="font-size:13px;color:{INK};padding:2px 0;"><span style="color:{MUTED};">Attached</span> {html.escape(name)}' + (f' <span style="color:{MUTED};">{html.escape(detail)}</span>' if detail else "") + "</div>")
            t_parts.append(f"Attached: {name}" + (f" ({detail})" if detail else ""))
        h.append(f'<tr><td style="padding:16px 28px 0;">{"".join(parts)}</td></tr>')
        t += t_parts + [""]

    footer = text(content.get("footer"), "footer") or brand["footer"]
    # Inside NerveCenter the agent's name is in OPS_AGENT_NAME: sign the mail as sent by it, unless the footer already names it.
    agent = os.environ.get("OPS_AGENT_NAME", "").strip()
    if agent and agent.lower() not in (footer or "").lower():
        footer = f"{footer} · Sent by {agent} via NerveCenter" if footer else f"Sent by {agent} via NerveCenter"
    if footer:
        t += ["--", plain(footer)]
    h.append(f'<tr><td style="padding:24px 28px;"><div style="border-top:1px solid {LINE};padding-top:14px;font-size:12px;line-height:18px;color:{MUTED};">{rich(footer)}</div></td></tr>')

    document = f"""<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{html.escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:{SURFACE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{html.escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{SURFACE}" style="background:{SURFACE};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:600px;background:#FFFFFF;border:1px solid {LINE};border-radius:8px;font-family:{font};">
{chr(10).join(h)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
"""
    return document, "\n".join(t).rstrip() + "\n", warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="email content JSON")
    parser.add_argument("--out-dir", type=Path, required=True, help="folder for email.html and email.txt")
    args = parser.parse_args(argv)
    try:
        document, body, warnings = render(json.loads(args.input.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, RenderError) as exc:
        print(f"render failed: {exc}", file=sys.stderr)
        return 1
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "email.html").write_text(document, encoding="utf-8")
    (args.out_dir / "email.txt").write_text(body, encoding="utf-8")
    print(json.dumps({"html": str(args.out_dir / "email.html"), "text": str(args.out_dir / "email.txt"), "warnings": warnings}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
