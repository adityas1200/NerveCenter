---
name: documents
description: Create, update, review, or publish an operational presentation, spreadsheet, Word document, PDF, Markdown report, or similar business artifact. Use whenever a deck, workbook, report, RCA document, runbook, SOP, handover, or publishable file is an input or output.
metadata:
  category: sequential
---

# Create high-quality operational documents

This skill supplies the operational narrative, source discipline, review, and publication method.

## Tools and templates

- Build files with Python: `python-docx` for Word, `openpyxl` for Excel, `python-pptx` for PowerPoint, `matplotlib` for chart images, `pypdf` for reading or merging PDFs. Convert to PDF and recalculate workbooks with headless LibreOffice (`soffice --headless --convert-to pdf`), and turn pages into images for review with poppler (`pdftoppm`). Check which of these are installed before relying on one.
- Start from the client's template when there is one: the workspace `templates/` folder holds one per format (`templates/word/`, `templates/ppt/`, `templates/html/`), and `documents.templates` in `operations.yaml` may name others. Open the template and fill it; keep its styles, layouts, and section order.
- `scripts/render_check.py` in this skill's folder is the render review step.

## 1. Define the job

Resolve the audience, purpose, decision or action, reporting period, output format, template, authoritative sources, and publication destination. State what the reader must understand or do after reading.

Build a small source ledger with source, owner, time window, extraction time, record IDs, and any current public citations. Use `research` for external facts that may have changed.

## 2. Reconcile before designing

- Check time boundaries, timezone, status mapping, duplicates, missing records, and conflicting totals.
- Separate facts, analysis, decisions, risks, open questions, and actions.
- Label estimates, incomplete periods, and assumptions.
- Do not copy rows or ticket text into a polished artifact without synthesis.

## 3. Create the right artifact

### Presentation

Plan a storyline before slides:

```text
Context -> result or impact -> evidence -> risks or blockers -> decision or next action
```

Use one message per slide, meaningful titles, readable hierarchy, and visuals that explain the point. Put supporting detail in an appendix.

### Spreadsheet

Keep source data, controlled mappings or assumptions, and summaries separate when practical. Use stable IDs, formulas for derived values, clear units, filters, frozen headers, and documented exceptions. Recalculate and check for formula errors before delivery.

### Document or report

Use an outline that matches the reader's decision. Lead with an executive summary, use short sections and evidence-backed tables, and keep detailed logs or raw evidence in appendices or links.

Load and apply `unslop` to narrative sections after facts and structure are reconciled. Do not run stylistic edits over formulas, source tables, citations, code, queries, logs, required templates, or machine-readable content.

## 4. Review before calling it ready

- Reconcile every number, claim, date, owner, link, and citation back to the source ledger.
- Render and inspect every page, slide, or sheet for overflow, clipping, contrast, formulas, and accessibility, then test it from a fresh reader's perspective: can they identify the result, risk, and requested action without background context?
- Revise after review; file creation alone is not completion.

## 5. Publish the exact reviewed file

Publish only the exact file you just reviewed — not a re-export or an earlier draft. Preserve the final filename, provider item ID or URL, version, file size, and a checksum (a short fingerprint that proves the file hasn't changed since review) when available. A later communication must use this exact artifact, not a stale local copy.

When the file will be emailed from the local workspace, create a JSON artifact
manifest beside the case artifacts and hand its workspace-relative path to
`communication`. This is a small machine-readable record, not user-facing text —
`size_bytes` is the file's size in bytes and `sha256` is that checksum:

```json
{
  "id": "incident-report-v1",
  "state": "ready",
  "location": "deliverables/incident-report.pdf",
  "media_type": "application/pdf",
  "size_bytes": 12345,
  "sha256": "<sha256-of-reviewed-file>"
}
```

Write the manifest only after the final render and review. If the document is
changed, review it again and replace the size and digest before email preview
generation. The communication workflow rechecks the file against this manifest.

Read [presentations](references/presentations.md), [spreadsheets](references/spreadsheets.md), [documents](references/documents.md), and [review and publishing](references/review-and-publishing.md) as needed.
