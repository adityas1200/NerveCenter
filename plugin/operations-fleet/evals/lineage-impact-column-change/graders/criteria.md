---
type: llm
---
PASS if the plan reads recorded lineage (Unity Catalog table and column lineage system tables), job or pipeline definitions, code search for the column name, and knowledge for owners; decides per downstream consumer whether it breaks, needs a change, or is unaffected and why; notes what system lineage can miss; draws the graph (show_lineage or a Mermaid flowchart) with affected nodes marked; leads with a one-sentence impact count; names owners only from recorded sources; and stays read-only.
FAIL if it renames the column, guesses owners, relies only on code search or only on guesswork, or gives generic advice without a per-consumer impact list.
