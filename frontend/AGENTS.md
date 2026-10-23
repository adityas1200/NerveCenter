# NerveCenter frontend - Agent guide

Repo-wide rules for every AI tool: `../AI_CODE_GUIDELINES.md`. Read it first; this file adds the frontend detail.

React 18 + Vite + TypeScript. The product design is in `../docs/DESIGN.md`; read it before adding a page.

## Required context

Before UI, styling or component changes read `README.md`, `STYLE_GUIDE.md`, `package.json` and `eslint.config.js`.
The style guide is the source of truth for colour, typography, density and component usage. Keep the current theme.

## Guardrails

- `npm run quality:check` runs governance, lint, typecheck, unit tests and build. Run it before handing frontend code changes over; during the edit loop, run the affected lint, typecheck or unit test first.
- Install the repository hook once per clone with `git config --local core.hooksPath .githooks` (run it from any repository subdirectory). It runs guardrails and staged docs checks on every commit, with focused checks for changed areas. The canonical handoff matrix is in `../AI_CODE_GUIDELINES.md`; do not bypass the hook without a human saying so.
- Editing an existing test file needs `AI_TEST_CHANGE_ACK=ack` at commit time after a human confirms the behaviour change.

## Component rules

- Generic controls come from `src/components/ui/` (shadcn/Radix). Operations-specific composites live in `src/components/ops/`.
- Do not add another UI kit.
- Chat with the agent has one engine: a Task (`/api/tasks/*`). The Task page and the slide-in agent panel both render it. Never fabricate agent replies client-side.

## Styling rules

- Inter (optical sizes; headings get the Display cut) for everything, JetBrains Mono for code and logs. Negative letter spacing only on display text (page titles, figures of 24px and up). No nested cards.
- Pages get their large title from `PageHeader`; pass `compact` only when the page opens with its own heading. Keyboard shortcuts live in `src/lib/shortcuts.ts` and are handled by `CommandPalette`; add a key there so the palette lists it.
- Colours come from tokens (`ink`, `surface`, `raised`, `elevated`, `line`, `brand`, and the Tailwind status families). Never `bg-white` or a hex: use `bg-raised`. Both themes follow from the tokens; there is no per-class dark override. After adding a Tailwind colour family, add it to `scripts/palette-families.cjs` and run `node scripts/gen-palette.mjs`.
- Colour only on status, priority and numbers. Flat cards. Restrained motion: in-progress items pulse, completed items are a solid dot.

## Data rules

- TanStack Query owns server state. All fetches live in `src/api/`; components never call `fetch()` directly.
- The backend routes in `../backend/src/api/server.mjs` are the contract. Section 5 of `../docs/DESIGN.md` lists the target API.
