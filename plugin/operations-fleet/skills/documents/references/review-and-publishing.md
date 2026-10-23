# Review and publishing

Review the content and the rendered artifact separately.

## Content review

- authoritative source and reporting boundary;
- totals, formulas, units, dates, owners, and links;
- unsupported statements or stale public facts;
- confidential or personal information;
- consistency across workbook, deck, report, and message.

## Render review

- every slide and page, plus important spreadsheet sheets;
- overflow, clipping, contrast, alignment, page breaks, chart labels, image quality, and placeholders;
- accessibility where the host supports checking it.

## Publication

- publish only after review is complete;
- compute or capture file size and digest when possible;
- preserve provider item ID, location, version, and permissions;
- read back the published item;
- do not overwrite an authoritative file without the configured policy;
- pass the exact published or reviewed artifact reference to communication.

For SharePoint or OneDrive, preserve the returned DriveItem ID instead of reconstructing identity from a display path. Current upload methods and limits should be confirmed in [Microsoft Graph file documentation](https://learn.microsoft.com/en-us/graph/api/resources/driveitem).
