# 0009. One component catalog for Sonic's generative UI

- Status: accepted (2026-10-11, approved by Mitesh Shinde in chat)
- Date: 2026-10-11
- Related: specs/tasks/generative-ui.md (SPEC-tasks-10), specs/tasks/agent-tools.md (SPEC-tasks-04 FR-7, FR-9), docs/research/generative-ui.md

## Context
- Sonic draws 11 kinds of card by calling `show_*` tools on the in-process nervecenter MCP server. Each tool's shape lives in `nervecenter-tools.mts`, its prompt line in `task-runtime.mts`, its parser in `cards/cards.ts` and its group in `taskEvents.ts` (`DRAW_TOOLS`). Adding a card means editing all four, and a card the frontend does not know renders as nothing.
- Cards render the model's tool input, so a number Sonic misreads shows as system data.
- Nothing in a card can be acted on except approvals and questions.
- The industry pattern for agent UIs at scale (ChatGPT Intelligent UI, A2UI, json-render, CopilotKit) is a fixed catalog of trusted components the model fills with data, with values bound to tool results where they matter and actions routed through the host.

## Decision
- **One catalog module.** `backend/src/tasks/ui-catalog.mjs` defines every component: kind, tool name, description and zod shape. From it we generate the `show_*` tools, the `show_view` block union, the categories check and the prompt lines. `nervecenter-tools.mts` spreads `catalogTools({ tool, task })` in place of the hand-written display tools.
- **Components are data.** The frontend has one parser per kind (`cards/blocks.ts`) and one renderer per kind (`cards/BlockCard.tsx` and the existing cards). An unknown kind renders as a generic card of its fields. No component sets model output as HTML or runs its script.
- **Bind numbers to the source where it matters.** `show_ticket` and `show_pipeline_runs` take ids; their handlers read through `operationsService` with the task's scope and return the rows, and the UI renders the `tool.result`. The other components keep rendering their input, which stays the model's summary of what it read.
- **Actions are messages, not a new write route.** A component action either sends a message as the reader (`ask`) or navigates (`open`). Any write Sonic then makes passes `canUseTool` and the permission policy as today. No endpoint is added and nothing bypasses `operationsService`.
- **Forms reuse the question flow.** `request_input` is intercepted in `TaskRuntime.#gate` like `AskUserQuestion`; its fields become question items carrying a `field` type, so the Inbox, the answer route and restart recovery work unchanged.
- **Plain-language approvals pair in the UI.** `explain_action` is a display tool. The thread pairs it with the next `approval.requested` in the same turn. The card always shows the server's policy category and the real input behind "Show command", so the model's summary cannot hide what runs.
- **No new dependency.** Charts use `components/ops/charts`; parsing uses plain TypeScript.

## Alternatives considered
- **CopilotKit + AG-UI.** Its Claude Agent SDK adapter needs SDK `^0.2.58` (we run 0.3.288), and it brings its own runtime and route alongside the current Express edge and route table.
- **assistant-ui or the Vercel AI SDK.** Either means adopting its message stream protocol end to end; neither has a Claude Agent SDK runtime.
- **A2UI or json-render as libraries.** Good shapes, which `show_view` copies (flat block list, one renderer per kind), but the libraries add a dependency for what is a few hundred lines here.
- **Agent-written HTML in a sandboxed iframe.** Most flexible, but needs a separate origin, an app CSP and gating of iframe tool calls (CVE-2026-58500), and gives up the house style. Deferred.
- **A write route for card actions.** Would need its own permission entries and audit; sending a message reuses the gate we already trust.

## Consequences
- Adding a component is one catalog entry, one parser and one renderer; until the renderer lands the generic card shows it.
- SPEC-tasks-04 FR-9 changes for data-bound tools (render from the result). SPEC-tasks-06 FR-15 to FR-17 and SPEC-tasks-09 move to the one-thread page.
- Sonic's prompt grows by the catalog lines. Only frequently used components are `alwaysLoad`; the rest load through tool search.
- Rollback: the catalog module and the new renderers are additive; restoring the old tools means reverting the commit. Stored events are unchanged, so old tasks render with the new page.
