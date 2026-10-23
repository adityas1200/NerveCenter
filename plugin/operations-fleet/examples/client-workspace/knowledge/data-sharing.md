---
type: Policy
title: Data sharing
description: Example rules for which sources a data pull may use, which columns are sensitive, and who may receive extracts.
status: stable
---

# Data sharing

## Approved sources

| Business term | Source | Grain | Notes |
|---|---|---|---|
| Sales | `gold.sales.daily_sales` | territory and day | exclude `is_test = true` |
| Territory | `gold.reference.territory` | territory | join on `territory_id` |

## Sensitive columns

Columns tagged `pii` in the catalog, plus any prescriber, patient, or employee identifier. Mask them or leave them out unless the recipient is in `analytics-privileged`.

## Limits

- Confirm before extracting more than 500,000 rows.
- Attach files up to 10 MB; publish larger files to `Operations/Extracts` and send the link.
- Extracts go only to the requester and people named in the ticket.
