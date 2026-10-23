---
id: SPEC-connectors-01
title: Connector catalog and connector cards
status: implemented
area: connectors
owners: []
code:
  - backend/src/connectors/connector-catalog.mjs
  - backend/src/connectors/connector-service.mjs
  - backend/src/api/connector-routes.mjs
last_verified: 2026-10-03
---

# Connector catalog and connector cards

## Purpose
Give admins one list of every system the agent and the data pages can talk to. The catalog declares six built-in connectors (what to ask for, which env vars the agent sees, which operations.yaml sections to seed). `GET /api/connectors` merges the catalog with whatever is in operations.yaml `connections` and reports a state per card.

## Scope
- In scope: catalog content, public shape of a card (`catalog()`), card building in `ConnectorService.list()`, state derivation, "used for" detection, conditional fields (`when`).
- Out of scope: saving/removing/testing (SPEC-connectors-02), managed profiles (SPEC-connectors-03), secrets (SPEC-connectors-04), email specifics (SPEC-connectors-06), UI (SPEC-connectors-07).

## Actors and permissions
- Writes under `/api/connectors` (PUT, POST, DELETE) are admin-only (`backend/src/app/rbac.mjs:66`).
- `GET /api/connectors` is NOT in the admin-only table, so any authenticated user can read it (see Known gaps). The UI hides the page from non-admins.

## Requirements
- **FR-1** The catalog SHALL contain exactly these built-in connectors in this order: `databricks`, `servicenow`, `atlassian`, `github`, `snowflake`, `email`, followed by the placeholder `custom`.
- **FR-2** `catalog()` SHALL return, per card, only public metadata (`id, name, short, description, usedBy, fields, secrets, hasMcpDefault`, optional `connectionKind`); it SHALL NOT expose `mcp`, `cli`, `managedProfile`, `operations`, and each secret SHALL appear as `{key,label,env,required[,when]}` only.
- **FR-3** A field or secret with `when: {k: v}` SHALL apply only when the (default-filled) settings have `settings[k] === v`; `applies()` and `withDefaults()` are the single definition shared by form and save path.
- **FR-4** `list()` SHALL return one `kind:'catalog'` card per built-in connector (never `custom`), then one `kind:'custom'` card for every entry in operations.yaml `connections` whose name is not a built-in id.
- **FR-5** A catalog card SHALL have `configured = connection exists in operations.yaml OR provider status configured OR (email only) SMTP_HOST set in env`.
- **FR-6** A catalog card `state` SHALL be `not_connected` when not configured; else `connected` when ready; else `error`. Ready is `status.ready && status.verified !== false` when a provider status exists, otherwise "a connection or env SMTP exists".
- **FR-7** `source` SHALL be `workspace` when a connection is in operations.yaml, `environment` when configured only via deployment env/status, else `null`.
- **FR-8** Every card SHALL carry `secretsSet`: the env names of the catalog's secrets that currently exist in the secret store (names only, never values).
- **FR-9** Every card SHALL carry `usedFor`: the labels of operations.yaml sections (`ticketing, platforms, identity, documents, communication, source_control, knowledge`) that contain a `connection:` key equal to the card id at any depth up to 6.
- **FR-10** Custom cards SHALL report `connectionKind` from `connection.kind` (default `mcp`), an `endpoint` string (api base_url, cli command+args, mcp command+args or url), `origin` `connectors` if created through the page (`connectors.<id>.custom`) else `operations`, and a generated description naming the kind and what it is used for when no description was saved.
- **FR-11** A card SHALL set `knowledgeSource: true` iff `operations.knowledge.connection === id`.
- **FR-12** `mcp` on a card SHALL be `{transport, command, args, url, env:[names], enabled}` for MCP connections and `{kind}` for other kinds; env values are never included.

## Scenarios
### S1 Catalog is public-safe
- **Given** the catalog **When** `catalog()` is called **Then** ids are `[databricks, servicenow, atlassian, github, snowflake, email, custom]`, no card has `mcp`/`cli`/`managedProfile`, and Atlassian secrets equal `[{key:'apiToken',label:'API token',env:'JIRA_API_TOKEN',required:true}]`.
### S2 Nothing configured
- **Given** an empty workspace **When** `list()` **Then** all six catalog cards are `not_connected`.
### S3 Connection kinds from setup skill
- **Given** operations.yaml has an `api` connection `mail` and a `cli` connection `git` **When** `list()` **Then** both are `kind:'custom'`, `connectionKind` `api`/`cli`, `mcp:null`, with the endpoint in `settings.base_url`/`settings.command`.
### S4 Used-for and knowledge source
- **Given** `identity.connection: identity`, `source_control.connection: git`, `knowledge.connection: confluence` **When** `list()` **Then** identity is used for "Access requests", git for "Code fixes", confluence is `knowledgeSource: true` and used for "Knowledge"; Databricks has `usedFor: []`.
### S5 Conditional fields
- **Given** Databricks `authMode: service_principal` **When** fields are filtered with `applies` **Then** `clientId` applies and `token` does not; with default `pat` the reverse.

## Interfaces
- HTTP: `GET /api/connectors` -> `200 {items: Card[]}`.
- Catalog entries (env var names are the contract with the agent's MCP servers):
  - `databricks`: fields host (`DATABRICKS_HOST`), authMode (`pat`|`service_principal`, default `pat`), clientId (`DATABRICKS_CLIENT_ID`), warehouseId (`DATABRICKS_WAREHOUSE_ID`); secrets token (`DATABRICKS_TOKEN`, when pat), clientSecret (`DATABRICKS_CLIENT_SECRET`, when service_principal); MCP `uvx databricks-mcp-server`; seeds `platforms[]` (writable:false).
  - `servicenow`: instance (`SERVICENOW_INSTANCE_URL`); secrets username/password; MCP `uvx --from git+https://github.com/echelon-ai-labs/servicenow-mcp servicenow-mcp` with `SERVICENOW_AUTH_TYPE=basic`; seeds `ticketing`.
  - `atlassian`: site (`JIRA_URL`), email (`JIRA_USERNAME`), project; secret apiToken (`JIRA_API_TOKEN`); MCP `uvx mcp-atlassian`; seeds `ticketing` platform `jira`.
  - `github` (kind `cli`): repository, defaultBranch (default `main`); secret token (`GITHUB_TOKEN`); command `gh`; seeds `source_control`.
  - `snowflake`: account, warehouse, database, schema, role (all with `SNOWFLAKE_*` env); secrets username (`SNOWFLAKE_USER`), password (`SNOWFLAKE_PASSWORD`); MCP `uvx mcp-snowflake-server`; seeds `platforms[]`.
  - `email` (kind `smtp`): see SPEC-connectors-06.
- Data: operations.yaml `connections.<id>`, `connectors.<id>.{settings,updatedAt,title,description,custom}`.

## Non-functional constraints
- Cards never contain secret values; only env names and booleans-by-presence (`secretsSet`).
- `list()` swallows a failing `providerStatuses()` (treated as empty).

## Known gaps / deviations
- `GET /api/connectors` is readable by any authenticated role on the backend; the admin restriction exists only in the UI redirect. Response contains endpoints, settings (hosts, emails, SMTP sender) and env var names.
- docs/DESIGN.md (Connectors section) lists "Atlassian (Jira and Bitbucket)" and omits GitHub and Email; the code has no Bitbucket connector (UI "Git / Bitbucket" tile creates a generic `cli` connection) and does have GitHub and Email.
- State is `error` (not `connected`) for a freshly saved managed connector until a test succeeds, because `verified` is false when `lastTest` is not `connected`; the UI works around it by testing immediately after save. Reason is `null` in that case.
- `github` and `email` have no provider status; once saved they show `connected` without any verification.
- A custom card's `connected` state is unconditional (no probing in `list()`).
- `usedFor` depth cap of 6 is silent.
- Cards for `kind: native` have no way to be created from the UI.

## Traceability
| Requirement | Code | Test |
|---|---|---|
| FR-1, FR-2 | `backend/src/connectors/connector-catalog.mjs:8-136` | `backend/tests/connectors.test.mjs:19` |
| FR-3 | `backend/src/connectors/connector-catalog.mjs:125-133` | `frontend/src/features/connectors/ConnectorAuthMode.test.tsx:36` (UI mirror); backend via `connectors.test.mjs:71` |
| FR-4 | `backend/src/connectors/connector-service.mjs:52-71` | `backend/tests/connectors.test.mjs:26` |
| FR-5, FR-6, FR-7 | `backend/src/connectors/connector-service.mjs:55-61` | `backend/tests/connectors.test.mjs:26,140` |
| FR-8 | `backend/src/connectors/connector-service.mjs:229` | `backend/tests/connectors.test.mjs:26` |
| FR-9 | `backend/src/connectors/connector-service.mjs:245-261` | `backend/tests/connector-uses.test.mjs:16,38` |
| FR-10, FR-11 | `backend/src/connectors/connector-service.mjs:63-71,262-276` | `backend/tests/connector-uses.test.mjs:38`; `connectors.test.mjs:118` |
| FR-12 | `backend/src/connectors/connector-service.mjs:239` | `backend/tests/connectors.test.mjs:26` |

## Open questions
- Should `GET /api/connectors` be admin-only server side?
