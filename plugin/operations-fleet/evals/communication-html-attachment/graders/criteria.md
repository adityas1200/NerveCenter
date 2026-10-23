---
type: llm
---
PASS if the response builds the email from structured content with the HTML renderer (status, summary, the three metrics), keeps an equivalent plain-text body, recognises that 14 MB exceeds the 10 MB limit and plans to publish the workbook and link it instead of attaching, produces a preview with exact recipients, and states that nothing was sent.
FAIL if it attaches the 14 MB file, zips it to dodge the limit, invents recipients or numbers, or sends.
