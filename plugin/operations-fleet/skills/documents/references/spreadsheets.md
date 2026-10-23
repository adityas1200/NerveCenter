# Spreadsheet quality

## Structure

- Preserve an existing workbook's conventions unless redesign is requested.
- Separate imported data, controlled mappings or assumptions, calculations, and summary views where practical.
- Use stable IDs as keys and avoid joining only on names.
- Use formulas for values that should update. Do not replace a formula with a hard-coded answer.
- Make units, currency, date range, timezone, and status mapping explicit.
- Use tables, filters, frozen headers, readable widths, and restrained formatting.

## Validation

- Recalculate the workbook with an available spreadsheet engine.
- Check formula errors, broken references, hidden rows or sheets, filters, merged cells, chart ranges, duplicate keys, missing values, and totals.
- Compare important results with an independent calculation or source query.
- Preserve macros only when the selected library and method support them.
- Document assumptions and exceptional mappings near the model.

## Reporting

A weekly ticket workbook should distinguish opening backlog, new work, completed work, carried work, reopened work, blockers, SLA status, category, and ownership. Do not count the same ticket in incompatible categories without explaining the measure.
