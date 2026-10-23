---
id: SPEC-connectors-07
title: Connectors page and dialogs (frontend)
status: implemented
area: connectors
owners: []
code:
  - frontend/src/features/connectors/ConnectorsPage.tsx
  - frontend/src/features/connectors/ConnectorDialogs.tsx
  - frontend/src/features/connectors/ConnectorLogo.tsx
  - frontend/src/api/connectors.ts
last_verified: 2026-10-03
---

# Connectors page and dialogs (frontend)

## Purpose
Let an admin connect systems, see how the agent reaches each one (MCP server, REST API, command line, mail server), where, what uses it, and whether it works, without editing operations.yaml.

## Scope
- In scope: the Connectors page (cards, test, remove, knowledge-source switch, Advanced `.mcp.json`), the Configure dialog, the Add connection dialog.
- Out of scope: backend behaviour (SPEC-connectors-01/02), the agent panel.

## Actors and permissions
Admin only. A non-admin (role loaded and not admin) is redirected to `/` (`Navigate`); queries are disabled for non-admins. The backend still enforces admin on writes only.

## Requirements
- **FR-1** The page SHALL list catalog cards first, then custom cards, then an "Add connection" dashed card, and show `"<connected> of <total> connected"` in the header with a refresh button.
- **FR-2** Each card SHALL show logo, state dot (`Not connected | Connected | Error`), name, kind label (MCP server / REST API / command line / ...; plus "from operations.yaml" for custom entries with `origin: operations`), description, a target row (Address/Server/Endpoint/Command), "Used for" (from `usedFor` labels, else `usedBy`), "Secrets N of M stored" (only when configured, not from environment and the card has secrets), and either the "Problem" (state error: reason or last test) or "Last test" message.
- **FR-3** A card with `source: environment` SHALL show "From environment" and hide the secrets row.
- **FR-4** Unconfigured catalog cards SHALL show a primary **Connect** button; configured cards show **Configure** (catalog only), **Test** and an overflow menu with **Remove**.
- **FR-5** Test SHALL call `POST /api/connectors/:id/test`, show the message on the card, and toast an error when `status: failed`, success "Connected" for `connected`, otherwise an informational result.
- **FR-6** Remove SHALL ask `window.confirm`, then `DELETE /api/connectors/:id`, toast that secrets were deleted, and refetch connectors, settings and `connections` queries.
- **FR-7** For MCP-kind configured cards whose id is not `databricks|snowflake|servicenow|jira`, the card SHALL show a "Use as a knowledge source" switch that writes `PUT` settings section `knowledge` with `{...existing, path: existing.path||'knowledge', connection: id|'' , mode: 'both'|'local'}`.
- **FR-8** The Advanced disclosure SHALL be collapsed by default and, when opened, show `{mcpServers}` from settings as JSON with a copy button and the count of MCP servers.
- **FR-9** The Configure dialog SHALL render only fields and secrets whose `when` applies to the current form settings (`fieldApplies`), seed defaults (`withFieldDefaults`), render `choices` as a select, and render secrets as password inputs with placeholder "keep" when already stored and hint `<ENV> · stored`.
- **FR-10** Connect/Save SHALL be disabled while saving or while a required applicable field is empty or a required applicable secret is neither stored nor typed; credentials of a non-applicable way of connecting SHALL NOT block it.
- **FR-11** Save SHALL send `PUT /api/connectors/:id` with `settings` limited to applicable fields and `secrets` limited to non-blank, applicable entries; the `mcp` override (stdio command+args or http/sse url) is sent only when "Use a different MCP server" is checked. The Advanced section is shown only when `hasMcpDefault !== false`.
- **FR-12** After a successful save the dialog SHALL close, toast "<name> saved - Testing the connection now", refetch, and trigger the test for that id.
- **FR-13** Add connection SHALL offer kinds MCP server, REST API, Command-line tool and Git / Bitbucket. Git is sent as a `cli` custom connection (command prefilled `git` for Bitbucket, `gh` for GitHub, not overwriting a user-edited command). Name is required; validity: api needs `^https?://\S+$` and a token when bearer; cli/git needs a command without spaces; MCP stdio needs a command, http/sse needs an `http(s)` URL.
- **FR-14** Environment variable rows (non-API kinds) SHALL upper-case the name, mask the value, and be sent in `env`; API bearer token is sent as `token`.
- **FR-15** The UI SHALL never display a stored secret value, and mutation errors SHALL surface as toasts with the backend message.

## Scenarios
### S1 Jira connect
- **Given** Jira unconfigured **When** admin fills site, email, token and clicks Connect **Then** `PUT /api/connectors/atlassian` carries `settings` and `secrets` separately; the card then tests.
### S2 Databricks service principal
- **When** "Authenticate as" is switched to service principal **Then** Client ID and client secret fields appear, the personal token field disappears, and the payload excludes `token`. Connect is not blocked by the token.
### S3 Cards describe themselves
- **Given** api, cli and mcp connections **Then** cards show the kind label, endpoint/command and used-for labels; brand marks use brand colours.
### S4 Knowledge source
- **When** the switch is turned on for an MCP card **Then** `knowledge` is written preserving the existing keys with `connection: <id>`.
### S5 Add REST API / Git
- **When** adding a REST API or a Git tile **Then** `POST /api/connectors/custom` is sent with `kind:'api'` or `kind:'cli'` respectively.
### S6 Non-admin
- **Then** redirected to `/`; no connector query fires.
### S7 Add card
- **Then** the dashed card opens Add connection and there is no duplicate header button.

## Interfaces
- Route: Connectors page (admin); client in `frontend/src/api/connectors.ts` (`connectorsApi.list/save/saveCustom/test/remove`, `connectorKeys`), settings API for the knowledge switch and `.mcp.json`.
- Types: `Connector`, `ConnectorField/Secret` (`when`), `ConnectorTest`, `ConnectionKind` (`mcp|api|cli|native|smtp`).
- States: loading (`QueryState` skeleton), error panel with retry (`QueryState`), empty (catalog cards always present), per-card testing `aria-busy`.

## Non-functional constraints
- Accessibility: switch has a label; kind picker is a radiogroup; overflow menu has a per-card label.
- Secrets inputs use `autoComplete="new-password"`.
- Agent screen context: visible connector ids, open dialog, "<n> of <m> connected" summary.

## Known gaps / deviations
- The page is hidden only client side; direct API reads still work for non-admins (SPEC-connectors-01).
- `DATA_SYSTEMS` hides the knowledge switch for ids `jira` (which is not a catalog id; the Atlassian connector's id is `atlassian`), so Atlassian MCP cards do show the switch while ServiceNow/Databricks/Snowflake do not.
- The Add dialog offers auth `none|bearer` only; backend accepts `basic|oauth` too. The Git tile with a custom name for GitHub vs the built-in `github` catalog card duplicates concepts; "Bitbucket" has no distinct backend support.
- "Set up with agent" button from docs/DESIGN.md (Connectors section) is not present.
- Remove confirmation for custom connections does not mention secret deletion; for catalog it says secrets are deleted.
- No UI to edit custom connections (remove and re-add).
- Environment-source email cards show "Configure" and can be saved, which then overrides the environment.
- Tests cover cards, auth-mode form logic, Jira connect, add dialogs and non-admin redirect; Test/Remove mutations, `.mcp.json` disclosure and error toasts are untested.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-4 | `frontend/src/features/connectors/ConnectorsPage.tsx:90-144,195-199` | `frontend/src/features/connectors/ConnectorsPage.test.tsx:27,83` |
| FR-2, FR-3 | `ConnectorsPage.tsx:149-176` | `frontend/src/features/connectors/ConnectorCards.test.tsx:35` |
| FR-5 | `ConnectorsPage.tsx:50-54` | none |
| FR-6 | `ConnectorsPage.tsx:55-60,119-123` | none |
| FR-7 | `ConnectorsPage.tsx:61-75,178-183` | `frontend/src/features/connectors/ConnectorCards.test.tsx:57` |
| FR-8 | `ConnectorsPage.tsx:225-259` | none |
| FR-9, FR-10 | `frontend/src/features/connectors/ConnectorDialogs.tsx:35-39,66-102` | `frontend/src/features/connectors/ConnectorAuthMode.test.tsx:36,46,86` |
| FR-11 | `ConnectorDialogs.tsx:40-54,116` | `ConnectorAuthMode.test.tsx:62`; `ConnectorsPage.test.tsx:27` |
| FR-12 | `ConnectorDialogs.tsx:53-54; ConnectorsPage.tsx:143` | `ConnectorsPage.test.tsx:27` |
| FR-13, FR-14 | `ConnectorDialogs.tsx:150-250` | `ConnectorCards.test.tsx:68,84` |
| FR-15 | `ConnectorDialogs.tsx:90-100`; `ConnectorsPage.tsx:50-60` | `ConnectorsPage.test.tsx:27` (partial) |

## Open questions
- Should the Atlassian card get the knowledge switch (Confluence) deliberately?
